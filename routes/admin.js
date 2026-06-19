const express = require('express');
const bcrypt = require('bcryptjs');
const { getDb } = require('../database');
const { verifyAdmin } = require('../middleware/auth');

const router = express.Router();

// Get all users
router.get('/users', verifyAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const users = db.all(`
      SELECT id, username, email, display_name, location, role, status, is_live, created_at
      FROM users
      ORDER BY created_at DESC
    `);
    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Create user
router.post('/users', verifyAdmin, async (req, res) => {
  try {
    const { username, email, password, displayName, location, role } = req.body;

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
      "INSERT INTO users (username, email, password, display_name, location, role) VALUES (?, ?, ?, ?, ?, ?)",
      [username, email, hashedPassword, displayName || username, location || '', role || 'broadcaster']
    );

    const userId = db.lastInsertRowid();
    res.json({ success: true, userId });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Update user
router.put('/users/:id', verifyAdmin, async (req, res) => {
  try {
    const { displayName, location, role, status } = req.body;
    const db = await getDb();

    db.run(
      'UPDATE users SET display_name = ?, location = ?, role = ?, status = ? WHERE id = ?',
      [displayName, location, role, status, req.params.id]
    );

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete user
router.delete('/users/:id', verifyAdmin, async (req, res) => {
  try {
    const db = await getDb();
    db.run("DELETE FROM users WHERE id = ? AND role != 'admin'", [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get broadcast stats
router.get('/stats', verifyAdmin, async (req, res) => {
  try {
    const db = await getDb();
    const totalUsers = db.get('SELECT COUNT(*) as count FROM users').count;
    const totalBroadcasters = db.get("SELECT COUNT(*) as count FROM users WHERE role = 'broadcaster'").count;
    const activeBroadcasts = db.get('SELECT COUNT(*) as count FROM users WHERE is_live = 1').count;
    const totalBroadcasts = db.get('SELECT COUNT(*) as count FROM broadcasts').count;

    res.json({
      stats: { totalUsers, totalBroadcasters, activeBroadcasts, totalBroadcasts }
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;