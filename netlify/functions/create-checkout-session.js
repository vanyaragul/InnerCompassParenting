const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: ''
        };
    }

    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const { mode, line_items, success_url, cancel_url, metadata } = JSON.parse(event.body);

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
                return {
                    statusCode: 400,
                    headers: {
                        'Access-Control-Allow-Origin': '*',
                        'Access-Control-Allow-Headers': 'Content-Type'
                    },
                    body: JSON.stringify({ 
                        error: 'Subscription amounts under $1 CAD are not supported by Stripe. Please use the one-time payment option.' 
                    })
                };
            }

            sessionConfig.subscription_data = {
                metadata: {
                    total_installments: installmentWeeks,
                    installment_number: 1,
                    total_amount: metadata.final_total,
                    auto_cancel_after: installmentWeeks
                }
            };
        }

        const session = await stripe.checkout.sessions.create(sessionConfig);

        console.log('Checkout session created:', session.id);
        
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: JSON.stringify({ 
                id: session.id,
                url: session.url 
            })
        };

    } catch (error) {
        console.error('Error creating checkout session:', error);
        return {
            statusCode: 500,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            body: JSON.stringify({ 
                error: error.message 
            })
        };
    }
};