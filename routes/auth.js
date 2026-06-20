const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb } = require('../database');
const { JWT_SECRET, verifyToken } = require('../middleware/auth');
const activeSessions = require('../session-store');

// Clean stale sessions every 30 minutes
setInterval(() => {
  const now = Date.now();
  const staleTimeout = 24 * 60 * 60 * 1000; // 24 hours
  for (const [userId, session] of activeSessions) {
    if (now - session.loginTime > staleTimeout) {
      activeSessions.delete(userId);
    }
  }
}, 30 * 60 * 1000);

const router = express.Router();

// Signup
router.post('/signup', async (req, res) => {
  try {
    const { username, email, password, displayName, location } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email and password are required' });
    }

    const db = await getDb();

    const existing = db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
    if (existing) {
      return res.status(400).json({ error: 'Username or email already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);

    db.run(
      "INSERT INTO users (username, email, password, display_name, location, role) VALUES (?, ?, ?, ?, ?, 'broadcaster')",
      [username, email, hashedPassword, displayName || username, location || '']
    );

    const userId = db.lastInsertRowid();

    const token = jwt.sign(
      { id: userId, username, role: 'broadcaster' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, token, user: { id: userId, username, role: 'broadcaster' } });
  } catch (error) {
    console.error('Signup error:', error.message, error.stack);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const db = await getDb();
    const user = db.get('SELECT * FROM users WHERE username = ? OR email = ?', [username, username]);

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Account is disabled' });
    }

    // Single session enforcement: reject if user already has an active session
    const userIdStr = String(user.id);
    if (activeSessions.has(userIdStr)) {
      return res.status(409).json({ error: 'User already logged in from another device. Logout first.' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    activeSessions.set(userIdStr, { token, loginTime: Date.now() });

    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({
      success: true,
      token,
      user: { id: user.id, username: user.username, role: user.role }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Logout
router.post('/logout', verifyToken, (req, res) => {
  activeSessions.delete(String(req.user.id));
  res.clearCookie('token');
  res.json({ success: true });
});

// Get current user
router.get('/me', verifyToken, async (req, res) => {
  try {
    const db = await getDb();
    const user = db.get('SELECT id, username, email, display_name, location, role, is_live FROM users WHERE id = ?', [req.user.id]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ user });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;