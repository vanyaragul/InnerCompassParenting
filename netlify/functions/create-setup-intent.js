const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const { customer_email, metadata } = JSON.parse(event.body);

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

        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Allow-Methods': 'POST, OPTIONS'
            },
            body: JSON.stringify({
                client_secret: setupIntent.client_secret,
                setup_intent_id: setupIntent.id
            })
        };

    } catch (error) {
        console.error('Setup Intent Error:', error);
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