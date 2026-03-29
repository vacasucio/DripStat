require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const axios = require('axios');
const basicAuth = require('basic-auth');
const fs = require('fs');

const patientRoutes = require('./routes/patient');
const labRoutes = require('./routes/labs');
const medicationRoutes = require('./routes/medications');
const vitalRoutes = require('./routes/vitals');
const censusRoutes = require('./routes/census');
const authRoutes = require('./auth');
const paymentsRoutes = require('./payments');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── HTTP Basic Auth ────────────────────────────────────────────────────────
// Protects all routes except /api/health (kept open for Railway health checks).
// Credentials are read from process.env on every request so the middleware is
// always registered — it simply passes through when the vars are not set.
app.use((req, res, next) => {
  if (req.path === '/api/health') return next();
  const authUser = process.env.BASIC_AUTH_USER;
  const authPass = process.env.BASIC_AUTH_PASS;
  if (!authUser || !authPass) return next(); // auth not configured — allow
  const credentials = basicAuth(req);
  if (!credentials || credentials.name !== authUser || credentials.pass !== authPass) {
    res.set('WWW-Authenticate', 'Basic realm="DoseDefender", charset="UTF-8"');
    return res.status(401).send('Authentication required');
  }
  next();
});

// ── Session middleware ──────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'dosedefender-dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000, // 8 hours
  },
}));

// ── PWA: manifest and service worker (explicit routes for correct headers) ──
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(__dirname, 'manifest.json'));
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

// ── Static files and HTML routes ───────────────────────────────────────────
// Serve /js directory explicitly (renalEngine.js, drugRules.js)
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use(express.static(path.join(__dirname)));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' };
app.get('/app', (req, res) => {
  res.set(NO_CACHE).sendFile(path.join(__dirname, 'app.html'));
});
app.get('/app/*', (req, res) => {
  res.set(NO_CACHE).sendFile(path.join(__dirname, 'app.html'));
});
app.get('/admin', (req, res) => {
  res.set(NO_CACHE).sendFile(path.join(__dirname, 'admin.html'));
});

// ── SMART on FHIR: App capabilities ────────────────────────────────────────
app.get('/smart-configuration', (req, res) => {
  const base = process.env.APP_BASE_URL || `http://localhost:${PORT}`;
  res.json({
    name: 'DoseDefender',
    description: 'Clinical dosing calculators — heparin, vancomycin AUC/MIC, and more',
    launch_url: `${base}/launch`,
    redirect_uris: [process.env.CERNER_REDIRECT_URI || `${base}/callback`],
    scopes_supported: ['launch', 'openid', 'fhirUser', 'patient/*.read'],
    capabilities: [
      'launch-ehr',
      'context-ehr-patient',
      'client-public',
      'sso-openid-connect',
    ],
  });
});

// ── SMART on FHIR: EHR Launch ───────────────────────────────────────────────
// GET /launch?iss=<fhir-base>&launch=<opaque-token>
// Discovers the authorization endpoint from the FHIR server's well-known config,
// stores iss/launch in the session, and redirects the user to Cerner login.
app.get('/launch', async (req, res) => {
  const { iss, launch } = req.query;
  if (!iss) return res.status(400).send('Missing iss parameter');

  try {
    const { data: smartConfig } = await axios.get(
      `${iss}/.well-known/smart-configuration`,
      { headers: { Accept: 'application/json' } }
    );

    req.session.iss = iss;
    req.session.launch = launch;
    req.session.authorizationEndpoint = smartConfig.authorization_endpoint;
    req.session.tokenEndpoint = smartConfig.token_endpoint;

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.CERNER_CLIENT_ID,
      redirect_uri: process.env.CERNER_REDIRECT_URI,
      scope: 'launch openid fhirUser patient/*.read',
      aud: iss,
      state: Math.random().toString(36).substring(2, 14),
    });
    if (launch) params.set('launch', launch);

    res.redirect(`${smartConfig.authorization_endpoint}?${params.toString()}`);
  } catch (err) {
    console.error('[SMART /launch]', err.message);
    res.status(500).send('Failed to initiate SMART launch: ' + err.message);
  }
});

// ── SMART on FHIR: Authorization callback ──────────────────────────────────
// GET /callback?code=<auth-code>&state=<state>
// Exchanges the authorization code for an access token, stores it in the session,
// and redirects to /app — optionally with the patient ID as a query param.
app.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing authorization code');

  const tokenEndpoint = req.session.tokenEndpoint;
  if (!tokenEndpoint) {
    console.warn('[SMART /callback] No tokenEndpoint in session — session may have expired');
    return res.redirect('/');
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.CERNER_REDIRECT_URI,
      client_id: process.env.CERNER_CLIENT_ID,
    });

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (process.env.CERNER_CLIENT_SECRET) {
      const creds = Buffer.from(
        `${process.env.CERNER_CLIENT_ID}:${process.env.CERNER_CLIENT_SECRET}`
      ).toString('base64');
      headers.Authorization = `Basic ${creds}`;
    }

    const { data: tokenData } = await axios.post(
      tokenEndpoint,
      params.toString(),
      { headers }
    );

    req.session.accessToken = tokenData.access_token;
    if (tokenData.refresh_token) req.session.refreshToken = tokenData.refresh_token;
    req.session.tokenExpiry = Date.now() + (tokenData.expires_in || 300) * 1000;
    req.session.patientId = tokenData.patient || null;

    const redirectTo = tokenData.patient ? `/app?patient_id=${tokenData.patient}` : '/app';
    res.redirect(redirectTo);
  } catch (err) {
    console.error('[SMART /callback]', err.message, err.response?.data);
    res.status(500).send('Token exchange failed: ' + err.message);
  }
});

// ── SMART on FHIR: Token refresh ───────────────────────────────────────────
// GET /api/token/refresh
// Uses the stored refresh token to obtain a new access token.
app.get('/api/token/refresh', async (req, res) => {
  const { refreshToken, tokenEndpoint } = req.session;
  if (!refreshToken) {
    return res.status(401).json({ error: 'No refresh token in session' });
  }
  if (!tokenEndpoint) {
    return res.status(400).json({ error: 'No token endpoint in session' });
  }

  try {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.CERNER_CLIENT_ID,
    });

    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    if (process.env.CERNER_CLIENT_SECRET) {
      const creds = Buffer.from(
        `${process.env.CERNER_CLIENT_ID}:${process.env.CERNER_CLIENT_SECRET}`
      ).toString('base64');
      headers.Authorization = `Basic ${creds}`;
    }

    const { data: tokenData } = await axios.post(
      tokenEndpoint,
      params.toString(),
      { headers }
    );

    req.session.accessToken = tokenData.access_token;
    if (tokenData.refresh_token) req.session.refreshToken = tokenData.refresh_token;
    req.session.tokenExpiry = Date.now() + (tokenData.expires_in || 300) * 1000;

    res.json({ success: true, expiresIn: tokenData.expires_in });
  } catch (err) {
    console.error('[Token Refresh]', err.message);
    res.status(500).json({ error: 'Token refresh failed', detail: err.message });
  }
});

// ── Debug: env inspection (remove after confirming Railway env injection) ──
app.get('/debug/env', (req, res) => {
  res.json({
    NODE_ENV:        process.env.NODE_ENV        ?? null,
    FHIR_BASE_URL:   process.env.FHIR_BASE_URL   ?? null,
    BASIC_AUTH_USER: process.env.BASIC_AUTH_USER ?? null,
    BASIC_AUTH_PASS: process.env.BASIC_AUTH_PASS ? `[set, length ${process.env.BASIC_AUTH_PASS.length}]` : null,
    PORT:            process.env.PORT            ?? null,
  });
});

// ── FHIR-backed API routes ─────────────────────────────────────────────────
app.use('/api/patient', patientRoutes);
app.use('/api/labs', labRoutes);
app.use('/api/medications', medicationRoutes);
app.use('/api/vitals', vitalRoutes);
app.use('/api/census', censusRoutes);

// ── Auth routes ────────────────────────────────────────────────────────────
app.use('/auth', authRoutes);

// ── Stripe webhook (needs raw body — must be before express.json()) ────────
// Raw body capture for Stripe webhook
app.use('/payments/webhook', express.raw({ type: 'application/json' }), (req, res, next) => {
  req.rawBody = req.body;
  next();
});
app.use('/payments', paymentsRoutes);

// ── Snap & Calculate helpers ───────────────────────────────────────────────
function getTodayET() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
}

function snapDailyLimit(user) {
  return user.billingPeriod === 'annual' ? 30 : 25;
}

function snapUsageToday(user) {
  const today = getTodayET();
  const analyses = user.dailyAnalyses || {};
  return analyses[today] || 0;
}

// ── GET /api/snap-usage ────────────────────────────────────────────────────
app.get('/api/snap-usage', authRoutes.requireAuth, (req, res) => {
  if (req.user.isAdmin === true) {
    return res.json({ used: 0, limit: -1, unlimited: true, date: getTodayET() });
  }
  const { readUsers } = require('./auth');
  const users = readUsers();
  const user = users.find(u => u.id === req.user.id);
  if (!user || user.tier !== 'pro') {
    return res.json({ used: 0, limit: 0, date: getTodayET() });
  }
  const limit = snapDailyLimit(user);
  const used = snapUsageToday(user);
  res.json({ used, limit, date: getTodayET(), billingPeriod: user.billingPeriod || 'monthly' });
});

// ── Snap & Calculate (Claude AI image extraction) ─────────────────────────
app.post('/api/snap-calculate', authRoutes.requireAuth, async (req, res) => {
  const { imageBase64, mimeType } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI extraction not configured' });

  // Verify user is PRO (or admin) and within daily limit
  const { readUsers, writeUsers } = require('./auth');
  const users = readUsers();
  const user = users.find(u => u.id === req.user.id);
  const isAdmin = req.user.isAdmin === true;

  if (!isAdmin && (!user || user.tier !== 'pro')) {
    return res.status(403).json({ error: 'PRO subscription required for Snap & Calculate' });
  }

  const today = getTodayET();
  let used = 0;
  let limit = 0;
  if (!isAdmin) {
    limit = snapDailyLimit(user);
    if (!user.dailyAnalyses) user.dailyAnalyses = {};
    used = user.dailyAnalyses[today] || 0;
    if (used >= limit) {
      return res.status(429).json({
        error: 'daily_limit_reached',
        used,
        limit,
        message: `You've used all ${limit} daily analyses. Need more? Contact us at hello@dosedefender.com — we can increase your limit or discuss a hospital plan.`,
      });
    }
    // Increment usage before API call (prevents double-clicks from bypassing limit)
    user.dailyAnalyses[today] = used + 1;
    writeUsers(users);
  }

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: 'You are a clinical data extractor. Extract clinical values from the provided image. Return ONLY a valid JSON object with no markdown, no explanation, no preamble. Use these exact keys and include only values you can clearly read from the image: weight_kg (number), height_cm (number), age (number), scr (serum creatinine, number), ptt (number), glucose (number), potassium (number), sodium (number), chloride (number), bicarbonate (number), bun (number), medications (array of strings with drug name and dose). Set any value you cannot read to null.',
        messages: [{
          role: 'user',
          content: [{
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType || 'image/png',
              data: imageBase64,
            }
          }, {
            type: 'text',
            text: 'Extract all clinical values from this image and return as JSON.'
          }]
        }]
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        }
      }
    );

    const text = response.data.content[0]?.text || '';
    let extracted;
    try {
      extracted = JSON.parse(text);
    } catch {
      // Try to extract JSON from response if there's any wrapping text
      const match = text.match(/\{[\s\S]*\}/);
      extracted = match ? JSON.parse(match[0]) : null;
    }

    if (!extracted) return res.status(422).json({ error: 'Could not parse extraction result' });

    if (isAdmin) {
      res.json({ extracted, usage: { used: 0, limit: -1, unlimited: true } });
    } else {
      // Re-read user to get fresh count (already incremented above)
      const freshUsers = readUsers();
      const freshUser = freshUsers.find(u => u.id === req.user.id);
      const newUsed = (freshUser?.dailyAnalyses?.[today]) || (used + 1);
      res.json({ extracted, usage: { used: newUsed, limit } });
    }
  } catch (err) {
    // Roll back usage increment on API error
    if (!isAdmin) {
      const rollbackUsers = readUsers();
      const rollbackUser = rollbackUsers.find(u => u.id === req.user.id);
      if (rollbackUser?.dailyAnalyses?.[today] > 0) {
        rollbackUser.dailyAnalyses[today]--;
        writeUsers(rollbackUsers);
      }
    }
    console.error('[Snap & Calculate]', err.response?.data || err.message);
    res.status(500).json({ error: 'Extraction failed: ' + (err.response?.data?.error?.message || err.message) });
  }
});

// ── Feedback ───────────────────────────────────────────────────────────────
app.post('/api/feedback', (req, res) => {
  const { message, page } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });
  const feedbackFile = path.join(__dirname, 'data/feedback.json');
  let feedback = [];
  try { feedback = JSON.parse(fs.readFileSync(feedbackFile, 'utf8')); } catch { feedback = []; }
  feedback.push({ id: Date.now().toString(36), message: message.trim(), page: page || '', createdAt: new Date().toISOString() });
  fs.writeFileSync(feedbackFile, JSON.stringify(feedback, null, 2));
  res.json({ success: true });
});

// ── Admin API: users list ──────────────────────────────────────────────────
app.get('/api/admin/users', authRoutes.requireAdmin, (req, res) => {
  const { readUsers } = require('./auth');
  const today = getTodayET();
  const users = readUsers().map(u => ({
    id: u.id, email: u.email, tier: u.tier,
    billingPeriod: u.billingPeriod || 'monthly',
    createdAt: u.createdAt, subscriptionStatus: u.subscriptionStatus,
    dailyUsageToday: u.dailyAnalyses?.[today] || 0,
    dailyLimit: u.tier === 'pro' ? snapDailyLimit(u) : 0,
  }));
  res.json(users);
});

app.post('/api/admin/set-tier', authRoutes.requireAdmin, express.json(), (req, res) => {
  const { email, tier } = req.body;
  if (!email || !tier || !['free','pro'].includes(tier)) return res.status(400).json({ error: 'Invalid request' });
  const { readUsers, writeUsers } = require('./auth');
  const users = readUsers();
  const user = users.find(u => u.email === email.toLowerCase().trim());
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.tier = tier;
  if (tier === 'free') { user.subscriptionStatus = 'manual_override'; }
  if (tier === 'pro') { user.subscriptionStatus = 'comped'; }
  writeUsers(users);
  res.json({ success: true, user: { email: user.email, tier: user.tier } });
});

// ── Health checks ──────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    fhirBase: process.env.FHIR_BASE_URL,
    smartEnabled: !!(process.env.CERNER_CLIENT_ID),
    sessionActive: !!(req.session?.accessToken),
  });
});

// ── v2 App routes ──────────────────────────────────────────────────────────
const NO_CACHE_V2 = { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' };
app.get('/app-v2', (req, res) => res.set(NO_CACHE_V2).sendFile(path.join(__dirname, 'app-v2.html')));
app.get('/app-v2/*', (req, res) => res.set(NO_CACHE_V2).sendFile(path.join(__dirname, 'app-v2.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));
app.get('/pricing', (req, res) => res.sendFile(path.join(__dirname, 'pricing.html')));
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'privacy.html')));
app.get('/feedback', (req, res) => {
  const feedbackFile = path.join(__dirname, 'data/feedback.json');
  try { res.json(JSON.parse(fs.readFileSync(feedbackFile, 'utf8'))); }
  catch { res.json([]); }
});

function ensureAdminUser() {
  const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const { readUsers, writeUsers } = require('./auth');
  const users = readUsers();
  let changed = false;
  users.forEach(u => { if (u.isAdmin) { u.isAdmin = false; changed = true; } });
  if (adminEmail) {
    const adminUser = users.find(u => u.email === adminEmail);
    if (adminUser) {
      adminUser.isAdmin = true; changed = true;
      console.log(`[Admin] isAdmin granted to: ${adminEmail}`);
    } else {
      console.warn(`[Admin] ADMIN_EMAIL="${adminEmail}" not found in users.json — register this account first`);
    }
  } else {
    console.log('[Admin] ADMIN_EMAIL not set — no admin user configured');
  }
  if (changed) writeUsers(users);
}

app.listen(PORT, () => {
  console.log(`DoseDefender server running on http://localhost:${PORT}`);
  console.log(`FHIR base: ${process.env.FHIR_BASE_URL}`);
  console.log(`SMART on FHIR: ${process.env.CERNER_CLIENT_ID ? 'configured' : 'not configured (open sandbox only)'}`);
  const authUser = process.env.BASIC_AUTH_USER;
  const authPass = process.env.BASIC_AUTH_PASS;
  if (authUser && authPass) {
    console.log(`Basic auth: ENABLED (user: "${authUser}", password length: ${authPass.length})`);
  } else {
    console.log(`Basic auth: DISABLED — BASIC_AUTH_USER=${authUser ?? 'not set'}, BASIC_AUTH_PASS=${authPass ? '[set]' : 'not set'}`);
  }
  ensureAdminUser();
});
