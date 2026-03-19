require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const axios = require('axios');
const basicAuth = require('basic-auth');

const patientRoutes = require('./routes/patient');
const labRoutes = require('./routes/labs');
const medicationRoutes = require('./routes/medications');
const vitalRoutes = require('./routes/vitals');
const censusRoutes = require('./routes/census');

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
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'app.html'));
});
app.get('/app/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'app.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
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

// ── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    fhirBase: process.env.FHIR_BASE_URL,
    smartEnabled: !!(process.env.CERNER_CLIENT_ID),
    sessionActive: !!(req.session?.accessToken),
  });
});

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
});
