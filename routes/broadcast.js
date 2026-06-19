const express = require('express');
const { getDb } = require('../database');
const { verifyToken } = require('../middleware/auth');

const router = express.Router();

// Start broadcast
router.post('/start', verifyToken, async (req, res) => {
  try {
    const db = await getDb();
    db.run('UPDATE users SET is_live = 1 WHERE id = ?', [req.user.id]);

    db.run(
      "INSERT INTO broadcasts (user_id, title, status) VALUES (?, ?, 'live')",
      [req.user.id, req.body.title || 'Live Broadcast']
    );

    const broadcastId = db.lastInsertRowid();
    res.json({ success: true, broadcastId });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Stop broadcast
router.post('/stop', verifyToken, async (req, res) => {
  try {
    const db = await getDb();
    db.run('UPDATE users SET is_live = 0 WHERE id = ?', [req.user.id]);
    db.run("UPDATE broadcasts SET status = 'ended', ended_at = CURRENT_TIMESTAMP WHERE user_id = ? AND status = 'live'", [req.user.id]);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get my broadcasts
router.get('/history', verifyToken, async (req, res) => {
  try {
    const db = await getDb();
    const broadcasts = db.all(
      'SELECT * FROM broadcasts WHERE user_id = ? ORDER BY started_at DESC LIMIT 50',
      [req.user.id]
    );
    res.json({ broadcasts });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;