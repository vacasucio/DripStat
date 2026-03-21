require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const fs = require('fs');

const authRoutes = require('./auth');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

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
app.get('/app-v2', (req, res) => res.set(NO_CACHE).sendFile(path.join(__dirname, 'app-v2.html')));
app.get('/app-v2/*', (req, res) => res.set(NO_CACHE).sendFile(path.join(__dirname, 'app-v2.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));

// ── Auth routes ─────────────────────────────────────────────────────────────
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
  const { imageBase64, mimeType } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'No image provided' });

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
        system: 'You are a clinical data extractor. Extract clinical values from the provided image. Return ONLY a valid JSON object with no markdown, no explanation, no preamble. Use these exact keys and include only values you can clearly read from the image: weight_kg (number), height_cm (number), age (number), scr (serum creatinine, number), ptt (number), glucose (number), potassium (number), sodium (number), chloride (number), bicarbonate (number), bun (number), medications (array of strings with drug name and dose). Set any value you cannot read to null.',
        messages: [{
          role: 'user',
          content: [{
            type: 'image',
            source: { type: 'base64', media_type: mimeType || 'image/png', data: imageBase64 }
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
      const match = text.match(/\{[\s\S]*\}/);
      extracted = match ? JSON.parse(match[0]) : null;
    }

    if (!extracted) return res.status(422).json({ error: 'Could not parse extraction result' });

    if (isAdmin) {
      res.json({ extracted, usage: { used: 0, limit: -1, unlimited: true } });
    } else {
      const freshUsers = readUsers();
      const freshUser = freshUsers.find(u => u.id === req.user.id);
      const newUsed = (freshUser?.dailyAnalyses?.[today]) || (used + 1);
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

// ── Feedback ────────────────────────────────────────────────────────────────
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

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

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

app.listen(PORT, () => {
  console.log(`DoseDefender Free running on http://localhost:${PORT}`);
  ensureAdminUser();
});
