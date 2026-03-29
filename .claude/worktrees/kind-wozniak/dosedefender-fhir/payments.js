const express = require('express');
const router = express.Router();
const { readUsers, writeUsers } = require('./auth');

// Stripe is initialized lazily so the server starts even without keys configured
function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not configured');
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
}

// ── POST /payments/create-checkout-session ─────────────────────────────────
router.post('/create-checkout-session', async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const jwt = require('jsonwebtoken');
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET || 'dosedefender-jwt-dev-secret-change-in-production');
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const { plan } = req.body; // 'monthly' or 'annual'
  const priceId = plan === 'annual'
    ? process.env.STRIPE_PRO_ANNUAL_PRICE_ID
    : process.env.STRIPE_PRO_MONTHLY_PRICE_ID;

  if (!priceId) return res.status(400).json({ error: 'Stripe price IDs not configured' });

  const users = readUsers();
  const user = users.find(u => u.id === decoded.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    const stripe = getStripe();
    const base = process.env.APP_BASE_URL || 'http://localhost:3000';

    const sessionParams = {
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      mode: 'subscription',
      success_url: `${base}/payments/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${base}/pricing?cancelled=1`,
      metadata: { userId: user.id, billingPeriod: plan === 'annual' ? 'annual' : 'monthly' },
      subscription_data: { metadata: { userId: user.id, billingPeriod: plan === 'annual' ? 'annual' : 'monthly' } },
    };

    // Attach to existing Stripe customer if available
    if (user.stripeCustomerId) {
      sessionParams.customer = user.stripeCustomerId;
    } else {
      sessionParams.customer_email = user.email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error('[Stripe]', err.message);
    res.status(500).json({ error: 'Failed to create checkout session: ' + err.message });
  }
});

// ── GET /payments/success ──────────────────────────────────────────────────
router.get('/success', async (req, res) => {
  const { session_id } = req.query;
  if (!session_id) return res.redirect('/pricing?error=missing_session');

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const userId = session.metadata?.userId;
    if (userId) {
      const users = readUsers();
      const user = users.find(u => u.id === userId);
      if (user) {
        user.tier = 'pro';
        user.stripeCustomerId = session.customer;
        user.stripeSubscriptionId = session.subscription;
        user.subscriptionStatus = 'active';
        if (session.metadata?.billingPeriod) user.billingPeriod = session.metadata.billingPeriod;
        writeUsers(users);
      }
    }
  } catch (err) {
    console.error('[Stripe success]', err.message);
  }

  res.redirect('/app-v2?upgraded=1');
});

// ── GET /payments/cancel ───────────────────────────────────────────────────
router.get('/cancel', (req, res) => {
  res.redirect('/pricing?cancelled=1');
});

// ── POST /payments/webhook ─────────────────────────────────────────────────
// NOTE: This route needs raw body — handled specially in server.js
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    const stripe = getStripe();
    event = webhookSecret
      ? stripe.webhooks.constructEvent(req.rawBody || req.body, sig, webhookSecret)
      : JSON.parse(req.body);
  } catch (err) {
    console.error('[Stripe webhook]', err.message);
    return res.status(400).send('Webhook Error: ' + err.message);
  }

  const users = readUsers();

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata?.userId;
    const user = users.find(u => u.id === userId);
    if (user) {
      user.tier = 'pro';
      user.stripeCustomerId = session.customer;
      user.stripeSubscriptionId = session.subscription;
      user.subscriptionStatus = 'active';
      if (session.metadata?.billingPeriod) user.billingPeriod = session.metadata.billingPeriod;
      writeUsers(users);
      console.log(`[Stripe] Upgraded ${user.email} to PRO (${user.billingPeriod || 'monthly'})`);
    }
  }

  if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.paused') {
    const sub = event.data.object;
    const user = users.find(u => u.stripeSubscriptionId === sub.id);
    if (user) {
      user.tier = 'free';
      user.subscriptionStatus = event.type === 'customer.subscription.paused' ? 'paused' : 'cancelled';
      writeUsers(users);
      console.log(`[Stripe] Downgraded ${user.email} to free`);
    }
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object;
    const user = users.find(u => u.stripeCustomerId === invoice.customer);
    if (user) {
      user.subscriptionStatus = 'past_due';
      writeUsers(users);
    }
  }

  res.json({ received: true });
});

module.exports = router;
