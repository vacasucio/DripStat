const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const USERS_FILE = path.join(__dirname, 'data/users.json');
const JWT_SECRET = () => process.env.JWT_SECRET || 'dosedefender-jwt-dev-secret-change-in-production';

function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch { return []; }
}

function writeUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, tier: user.tier, isAdmin: user.isAdmin === true },
    JWT_SECRET(),
    { expiresIn: '30d' }
  );
}

// ── JWT middleware (exported for use in other routes) ──────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    req.user = jwt.verify(token, JWT_SECRET());
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.isAdmin !== true) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    // Re-verify against live users.json — prevents old tokens from working after ADMIN_EMAIL is revoked
    const users = readUsers();
    const liveUser = users.find(u => u.id === req.user.id);
    if (!liveUser || liveUser.isAdmin !== true) {
      return res.status(403).json({ error: 'Admin access revoked' });
    }
    next();
  });
}

// Optional auth — sets req.user if token present, continues either way
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET()); } catch { /* ignore */ }
  }
  next();
}

// ── POST /auth/register ────────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const emailLower = email.toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLower)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  const users = readUsers();
  if (users.find(u => u.email === emailLower)) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = {
    id: generateId(),
    email: emailLower,
    passwordHash,
    tier: 'free',
    createdAt: new Date().toISOString(),
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
  };
  users.push(user);
  writeUsers(users);

  const token = signToken(user);
  res.json({ token, user: { id: user.id, email: user.email, tier: user.tier } });
});

// ── POST /auth/login ───────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const emailLower = email.toLowerCase().trim();

  const users = readUsers();
  const user = users.find(u => u.email === emailLower);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

  const token = signToken(user);
  res.json({ token, user: { id: user.id, email: user.email, tier: user.tier } });
});

// ── POST /auth/logout ──────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  // JWT is stateless — client should delete the token
  res.json({ success: true });
});

// ── GET /auth/me ───────────────────────────────────────────────────────────
router.get('/me', requireAuth, (req, res) => {
  const users = readUsers();
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ id: user.id, email: user.email, tier: user.tier, billingPeriod: user.billingPeriod || 'monthly', createdAt: user.createdAt, subscriptionStatus: user.subscriptionStatus, isAdmin: user.isAdmin === true });
});

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.requireAdmin = requireAdmin;
module.exports.optionalAuth = optionalAuth;
module.exports.readUsers = readUsers;
module.exports.writeUsers = writeUsers;
