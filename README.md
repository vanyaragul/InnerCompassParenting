# InnerCompassParenting
Autism parenting coaching website with custom booking system

## Local Development Setup

1. **Copy environment file:**
   ```bash
   cp .env.example .env
   ```

2. **Set your Stripe secret key in `.env`:**
   ```
   STRIPE_SECRET_KEY=sk_test_your_actual_key_here
   ```

3. **Install dependencies and start:**
   ```bash
   npm install
   npm start
   ```

## Deployment Setup

1. **Set environment variable** `STRIPE_SECRET_KEY` in your hosting platform settings
2. **Redeploy** your application
3. **Important:** Client code uses only the publishable `pk_` key. Never expose `sk_` keys in client-side code
