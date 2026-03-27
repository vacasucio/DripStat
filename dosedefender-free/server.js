require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

const basicAuth = require('basic-auth');
const authRoutes = require('./auth');

const app = express();
const PORT = process.env.PORT || 3001;

console.log('[startup] Railway injected PORT:', process.env.PORT);
console.log('[startup] ANTHROPIC_API_KEY:', process.env.ANTHROPIC_API_KEY ? 'configured' : 'NOT SET');

// ── Health check (unprotected — Railway needs this) ──────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ── CORS — must run before basic auth so CORS headers appear on every response,
//    including 401s, so the browser receives them and doesn't report a CORS error.
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : [
      'https://dosedefender.com',
      'https://www.dosedefender.com',
      'https://dosesafe-production-9991.up.railway.app',
      'https://dosesafe-production-34bc.up.railway.app',
      'http://localhost:3001',
      'http://localhost:3000',
    ];
app.use(cors({
  origin(origin, callback) {
    // Allow requests with no origin (same-origin, curl, mobile apps)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));

// ── HTTP Basic Auth — protects ALL routes except /api/health ─────────────────
// OPTIONS preflight requests never carry credentials in browsers, so they must
// be allowed through; the subsequent credentialed request will still be checked.
const BASIC_USER = process.env.BASIC_AUTH_USER;
const BASIC_PASS = process.env.BASIC_AUTH_PASS;
if (BASIC_USER && BASIC_PASS) {
  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') return next();
    if (req.path === '/api/health') return next();
    if (req.path === '/login') return next();
    if (req.path.startsWith('/auth/')) return next();
    const credentials = basicAuth(req);
    if (credentials && credentials.name === BASIC_USER && credentials.pass === BASIC_PASS) {
      return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="DoseDefender"');
    res.status(401).send('Unauthorized');
  });
}

app.use(express.json({ limit: '10mb' }));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — please try again in 15 minutes.' },
});

// ── PWA: manifest and service worker ───────────────────────────────────────
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(__dirname, 'manifest.json'));
});

app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Service-Worker-Allowed', '/');
  res.sendFile(path.join(__dirname, 'sw.js'));
});

// ── Static files ────────────────────────────────────────────────────────────
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use(express.static(path.join(__dirname)));

// ── HTML routes ─────────────────────────────────────────────────────────────
const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' };
app.get('/', (req, res) => res.set(NO_CACHE).sendFile(path.join(__dirname, 'app-v2.html')));
app.get('/app', (req, res) => res.set(NO_CACHE).sendFile(path.join(__dirname, 'app-v2.html')));
app.get('/app/*', (req, res) => res.set(NO_CACHE).sendFile(path.join(__dirname, 'app-v2.html')));
app.get('/admin', (req, res) => res.set(NO_CACHE).sendFile(path.join(__dirname, 'admin.html')));
app.get('/app-v2', (req, res) => res.set(NO_CACHE).sendFile(path.join(__dirname, 'app-v2.html')));
app.get('/app-v2/*', (req, res) => res.set(NO_CACHE).sendFile(path.join(__dirname, 'app-v2.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/register', (req, res) => res.status(403).send('Registration is by invitation only. Contact your administrator.'));

// ── Legal pages ─────────────────────────────────────────────────────────────
app.get('/terms', (req, res) => res.set(NO_CACHE).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Terms of Service — DoseDefender</title><style>body{font-family:system-ui,sans-serif;max-width:700px;margin:60px auto;padding:0 20px;color:#1a1a2e;line-height:1.7}h1{color:#1565c0}a{color:#1565c0}</style></head><body><h1>Terms of Service</h1><p><strong>Last updated:</strong> ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</p><h2>1. Educational Use Only</h2><p>DoseDefender is an educational and clinical reference tool intended for use by licensed healthcare professionals. All calculations and recommendations must be independently verified against current clinical guidelines, institutional protocols, and patient-specific factors before any clinical decision is made.</p><p style="color:#c62828;font-weight:700;background:#fff5f5;padding:12px 16px;border-left:4px solid #c62828;border-radius:4px;">⚠ This tool does NOT constitute medical advice and is NOT a substitute for professional clinical judgment.</p><h2>2. No Liability</h2><p>DoseDefender and its developers assume no liability for clinical decisions made based on output from this tool. Users accept full responsibility for verifying all calculations.</p><h2>3. Account Responsibility</h2><p>You are responsible for maintaining the confidentiality of your account credentials. Do not enter real patient identifiers into this system.</p><h2>4. Changes</h2><p>We may update these terms at any time. Continued use of the service constitutes acceptance of the updated terms.</p><p style="margin-top:32px;"><a href="/">← Back to App</a></p></body></html>`));

app.get('/privacy', (req, res) => res.set(NO_CACHE).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Privacy Policy — DoseDefender</title><style>body{font-family:system-ui,sans-serif;max-width:700px;margin:60px auto;padding:0 20px;color:#1a1a2e;line-height:1.7}h1{color:#1565c0}a{color:#1565c0}</style></head><body><h1>Privacy Policy</h1><p><strong>Last updated:</strong> ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}</p><h2>What We Collect</h2><p>DoseDefender collects your email address and a bcrypt-hashed password for authentication purposes only. We do not collect, store, or transmit patient data — all clinical calculations are processed locally in your browser.</p><h2>How We Use It</h2><p>Your email is used solely to identify your account and manage your subscription tier. We do not sell or share your personal data with third parties.</p><h2>Data Storage</h2><p>Account data is stored on our server. Calculator inputs and patient data you enter remain in your browser session and are not sent to our servers (except when using AI-powered features like Snap & Calculate or Medication Import, which send only the image or text you explicitly submit).</p><h2>Cookies &amp; Local Storage</h2><p>We use localStorage to persist your session and preferences on your device. No third-party tracking cookies are used.</p><h2>Contact</h2><p>For privacy questions, contact <a href="mailto:hello@dosedefender.com">hello@dosedefender.com</a>.</p><p style="margin-top:32px;"><a href="/">← Back to App</a></p></body></html>`));

// ── Auth routes ─────────────────────────────────────────────────────────────
app.post('/auth/register', authLimiter, (req, res) => res.status(403).json({ error: 'Registration is by invitation only. Contact your administrator.' }));
app.post('/auth/login', authLimiter);
app.use('/auth', authRoutes);

// ── Snap & Calculate helpers ────────────────────────────────────────────────
function getTodayET() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
}
function snapDailyLimit(user) {
  return user.billingPeriod === 'annual' ? 30 : 25;
}
function snapUsageToday(user) {
  const today = getTodayET();
  return (user.dailyAnalyses || {})[today] || 0;
}

// ── GET /api/snap-usage ─────────────────────────────────────────────────────
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

// ── POST /api/snap-calculate ────────────────────────────────────────────────
app.post('/api/snap-calculate', authRoutes.requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI extraction not configured' });

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
        message: `You've used all ${limit} daily analyses. Contact us at hello@dosedefender.com to increase your limit.`,
      });
    }
    user.dailyAnalyses[today] = used + 1;
    writeUsers(users);
  }

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: 'You are a clinical data extractor. Extract clinical values from OCR-processed text. The text may contain OCR artifacts such as merged words, substituted characters (e.g. "0" for "O", "|" for "l", "rn" for "m"), or misaligned columns — use clinical pharmacology knowledge to correct obvious errors. Return ONLY a valid JSON object with no markdown, no explanation, no preamble. Use these exact keys and include only values you can clearly identify from the text: weight_kg (number), height_cm (number), age (number), scr (serum creatinine, number), ptt (number), glucose (number), potassium (number), sodium (number), chloride (number), bicarbonate (number), bun (number), medications (array of strings with drug name and dose). Set any value you cannot identify to null.',
        messages: [{
          role: 'user',
          content: `Extract all clinical values from the following OCR text and return as JSON:\n\n${text.trim()}`
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
      const match = text.match(/\{[\s\S]*\}/);
      extracted = match ? JSON.parse(match[0]) : null;
    }

    if (!extracted) return res.status(422).json({ error: 'Could not parse extraction result' });

    if (isAdmin) {
      res.json({ extracted, usage: { used: 0, limit: -1, unlimited: true } });
    } else {
      const freshUsers = readUsers();
      const freshUser = freshUsers.find(u => u.id === req.user.id);
      const newUsed = (freshUser?.dailyAnalyses?.[today]) ?? (used + 1);
      res.json({ extracted, usage: { used: newUsed, limit } });
    }
  } catch (err) {
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

// ── POST /api/parse-medications ─────────────────────────────────────────────
app.post('/api/parse-medications', authRoutes.requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'No text provided' });
  if (text.length > 100000) return res.status(413).json({ error: 'Text too long' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI extraction not configured' });

  const prompt = `You are a clinical pharmacist extracting a structured medication list from clinical text.

Extract every medication from the text below and return ONLY a JSON array with no markdown, no explanation, and no surrounding text. Each element must have exactly these string fields:
- "name": drug name only, no dose or dosage form (e.g. "Metformin", not "Metformin 500mg tablet")
- "dose": dose and units (e.g. "500 mg", "10 units", "40 mg/2 mL"). Empty string if not present.
- "frequency": dosing schedule (e.g. "BID", "Daily", "twice daily", "every 8 hours"). Empty string if not present.
- "route": route of administration (e.g. "Oral", "IV", "SQ", "Topical"). Empty string if not present.
- "instructions": full sig or directions string if present (e.g. "Take 1 tablet by mouth twice daily with food"). Empty string if not present.

Rules:
- Do not include table headers, column labels, patient metadata, dates, or any non-medication content.
- If the same drug appears multiple times with the same dose, include it once.
- Return only the JSON array and nothing else.

Note: The text below may have been extracted via OCR and may contain artifacts such as merged words, substituted characters (e.g. "0" for "O", "|" for "l", "rn" for "m"), or misaligned columns. Use clinical pharmacology knowledge to correct obvious OCR errors when extracting medication names and doses.

Text:
${text.trim()}`;

  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
      }
    );

    const raw = response.data.content[0]?.text || '';
    let medications;
    try {
      medications = JSON.parse(raw);
    } catch {
      const match = raw.match(/\[[\s\S]*\]/);
      medications = match ? JSON.parse(match[0]) : [];
    }

    if (!Array.isArray(medications)) medications = [];
    res.json({ medications });
  } catch (err) {
    console.error('[parse-medications]', err.response?.data || err.message);
    res.status(500).json({ error: 'Medication extraction failed: ' + (err.response?.data?.error?.message || err.message) });
  }
});

// ── POST /api/ams-analyze ────────────────────────────────────────────────────
const amsRateLimit = rateLimit({ windowMs: 60 * 1000, max: 10, message: { error: 'Too many requests' } });
app.post('/api/ams-analyze', authRoutes.requireAuth, amsRateLimit, async (req, res) => {
  const { systemPrompt, userContent } = req.body;
  if (!userContent || !userContent.trim()) return res.status(400).json({ error: 'No content provided' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'AI analysis not configured' });
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: systemPrompt || 'You are a clinical pharmacist specializing in infectious disease.',
        messages: [{ role: 'user', content: userContent.trim() }],
      },
      {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
      }
    );
    const content = response.data.content[0]?.text || '';
    res.json({ content });
  } catch (err) {
    console.error('[ams-analyze]', err.response?.data || err.message);
    res.status(500).json({ error: 'Analysis failed: ' + (err.response?.data?.error?.message || err.message) });
  }
});

// ── Feedback ────────────────────────────────────────────────────────────────
app.post('/api/feedback', (req, res) => {
  const { message, page } = req.body;
  if (!message || !message.trim()) return res.status(400).json({ error: 'Message required' });
  const feedbackFile = path.join(__dirname, 'data/feedback.json');
  let feedback = [];
  try { feedback = JSON.parse(fs.readFileSync(feedbackFile, 'utf8')); } catch { feedback = []; }
  feedback.push({ id: Date.now().toString(36), message: message.trim(), page: page || '', createdAt: new Date().toISOString() });
  try {
    fs.writeFileSync(feedbackFile, JSON.stringify(feedback, null, 2));
  } catch (writeErr) {
    console.error('[feedback] Failed to write feedback.json:', writeErr.message);
    return res.status(500).json({ error: 'Failed to save feedback' });
  }
  res.json({ success: true });
});

// ── Admin API ────────────────────────────────────────────────────────────────
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

app.post('/api/admin/set-tier', authRoutes.requireAdmin, (req, res) => {
  const { email, tier } = req.body;
  if (!email || !tier || !['free', 'pro'].includes(tier)) return res.status(400).json({ error: 'Invalid request' });
  const { readUsers, writeUsers } = require('./auth');
  const users = readUsers();
  const user = users.find(u => u.email === email.toLowerCase().trim());
  if (!user) return res.status(404).json({ error: 'User not found' });
  user.tier = tier;
  user.subscriptionStatus = tier === 'pro' ? 'comped' : 'manual_override';
  writeUsers(users);
  res.json({ success: true, user: { email: user.email, tier: user.tier } });
});

// ── Admin user bootstrap ─────────────────────────────────────────────────────
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
  }
  if (changed) writeUsers(users);
}

// ── 404 handler ──────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).send('Not found');
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  // Axios errors carry err.config.data which is the JSON-serialised request body sent to the
  // upstream API — this may include OCR text or medication text. Log only status and message.
  // Never log the full request payload.
  const logMsg = err.isAxiosError
    ? `[axios ${err.response?.status ?? 'no-status'}] ${err.message}`
    : (err.stack || String(err));
  console.error('[unhandled error]', logMsg);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Internal server error' });
  res.status(500).send('Internal server error');
});

app.listen(PORT, () => {
  console.log(`DoseDefender Free running on http://localhost:${PORT}`);
  ensureAdminUser();
});
