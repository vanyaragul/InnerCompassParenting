// Load env from .env during local dev
require('dotenv').config();

// Railway-specific debugging
console.log('=== RAILWAY DEBUG ===');
console.log('RAILWAY_ENVIRONMENT:', process.env.RAILWAY_ENVIRONMENT);
console.log('RAILWAY_PROJECT_ID:', process.env.RAILWAY_PROJECT_ID);
console.log('All env vars available:', Object.keys(process.env).sort());
console.log('===================');

// Debug environment variables
console.log('Environment check:');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('All env vars:', Object.keys(process.env).filter(key => key.includes('STRIPE')));
console.log('STRIPE_SECRET_KEY present:', !!process.env.STRIPE_SECRET_KEY);
console.log('STRIPE_SECRET_KEY length:', process.env.STRIPE_SECRET_KEY?.length || 0);

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('❌ STRIPE_SECRET_KEY is missing from environment variables');
  throw new Error('Missing STRIPE_SECRET_KEY. Set it in your deployment env or in a local .env file.');
}

console.log('✅ STRIPE_SECRET_KEY found, initializing Stripe...');

const express = require('express');
const cors = require('cors');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
    origin: process.env.NODE_ENV === 'production' 
        ? ['https://innercompassparenting.netlify.app']
        : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5000']
}));
app.use(express.json());
app.use(express.static('.'));

// Create Setup Intent for $0 authorization (Single Session Booking)
app.post('/create-setup-intent', async (req, res) => {
    try {
        const { customer_email, metadata } = req.body;

        console.log('Creating setup intent for single session:', metadata);

        // Create a setup intent for $0 authorization
        const setupIntent = await stripe.setupIntents.create({
            usage: 'off_session',
            payment_method_types: ['card'],
            metadata: {
                ...metadata,
                booking_type: 'single_session',
                customer_email: customer_email || ''
            }
        });

        res.json({
            client_secret: setupIntent.client_secret,
            setup_intent_id: setupIntent.id
        });

    } catch (error) {
        console.error('Setup Intent Error:', error);
        res.status(500).json({
            error: error.message
        });
    }
});

// Create Stripe Checkout Session
app.post('/create-checkout-session', async (req, res) => {
    try {
        const { mode, line_items, success_url, cancel_url, metadata } = req.body;

        console.log('Creating checkout session:', {
            mode,
            line_items,
            metadata
        });

        const sessionConfig = {
            payment_method_types: ['card'],
            line_items: line_items,
            mode: mode,
            success_url: success_url,
            cancel_url: cancel_url,
            metadata: metadata,
            billing_address_collection: 'required',
            shipping_address_collection: {
                allowed_countries: ['CA'], // Canada only
            },
            phone_number_collection: {
                enabled: true,
            },
        };

        // Only add customer_creation for payment mode
        if (mode === 'payment') {
            sessionConfig.customer_creation = 'always';
        }

        // For subscription mode, add specific configuration
        if (mode === 'subscription') {
            const weeklyAmount = parseFloat(metadata.weekly_amount);
            const installmentWeeks = parseInt(metadata.installment_weeks);
            
            if (weeklyAmount < 1) {
                // For amounts less than $1, we'll use a different approach
                // Convert to a series of payment intents instead of subscription
                return res.json({ 
                    error: 'Subscription amounts under $1 CAD are not supported by Stripe. Please use the one-time payment option.' 
                });
            }

            // Set up subscription that will be cancelled after specified weeks
            sessionConfig.subscription_data = {
                metadata: {
                    total_installments: installmentWeeks,
                    installment_number: 1,
                    total_amount: metadata.final_total,
                    auto_cancel_after: installmentWeeks
                }
                // Remove trial_period_days to start immediately with first payment
            };
        }

        const session = await stripe.checkout.sessions.create(sessionConfig);

        console.log('Checkout session created:', session.id);
        
        res.json({ 
            id: session.id,
            url: session.url 
        });

    } catch (error) {
        console.error('Error creating checkout session:', error);
        res.status(500).json({ 
            error: error.message 
        });
    }
});

// Handle successful payments (webhook endpoint)
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        // Replace with your actual webhook secret from Stripe dashboard
        const endpointSecret = 'whsec_your_webhook_secret_here';
        event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);
    } catch (err) {
        console.log(`Webhook signature verification failed.`, err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            console.log('Payment successful:', session);
            
            // Here you would typically:
            // 1. Update your database with the payment info
            // 2. Send confirmation email to customer
            // 3. Provision the sessions/services
            
            break;
        case 'invoice.payment_succeeded':
            const invoice = event.data.object;
            console.log('Subscription payment successful:', invoice);
            
            // Handle recurring payment success and auto-cancellation
            if (invoice.subscription) {
                try {
                    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
                    const metadata = subscription.metadata;
                    
                    if (metadata.auto_cancel_after) {
                        const totalInstallments = parseInt(metadata.total_installments);
                        const currentInstallment = parseInt(metadata.installment_number || 1);
                        
                        console.log(`Payment ${currentInstallment} of ${totalInstallments} received`);
                        
                        if (currentInstallment >= totalInstallments) {
                            // Cancel the subscription after final payment
                            await stripe.subscriptions.cancel(subscription.id);
                            console.log(`Subscription ${subscription.id} automatically cancelled after ${totalInstallments} payments`);
                        } else {
                            // Update installment counter
                            await stripe.subscriptions.update(subscription.id, {
                                metadata: {
                                    ...metadata,
                                    installment_number: (currentInstallment + 1).toString()
                                }
                            });
                        }
                    }
                } catch (error) {
                    console.error('Error handling subscription payment:', error);
                }
            }
            
            break;
        case 'customer.subscription.deleted':
            const subscription = event.data.object;
            console.log('Subscription cancelled:', subscription);
            
            // Handle subscription cancellation
            
            break;
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.json({received: true});
});

// Retrieve checkout session (for success page)
app.get('/checkout-session/:sessionId', async (req, res) => {
    try {
        const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
        res.json(session);
    } catch (error) {
        console.error('Error retrieving session:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get customer portal URL (for managing subscriptions)
app.post('/create-portal-session', async (req, res) => {
    try {
        const { customer_id, return_url } = req.body;
        
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: customer_id,
            return_url: return_url || `${req.headers.origin}/custom_package_stripe.html`,
        });

        res.json({ url: portalSession.url });
    } catch (error) {
        console.error('Error creating portal session:', error);
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Stripe server is running' });
});

app.listen(PORT, () => {
    console.log(`🚀 Stripe server running on port ${PORT}`);
    console.log(`💳 Ready to process payments with Inner Compass Parenting`);
    if (process.env.NODE_ENV !== 'production') {
        console.log(`🔧 Test your integration at http://localhost:${PORT}/booking_package.html`);
    }
});

module.exports = app;
