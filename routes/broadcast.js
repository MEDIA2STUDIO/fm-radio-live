const express = require('express');
const { getDb } = require('../database');
const { verifyToken } = require('../middleware/auth');
const { savedPlaylists } = require('../persistent-broadcast');

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
    // Clear in-memory playlist cache so WS close doesn't persist
    savedPlaylists.delete(String(req.user.id));
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

// Save playlist to server (for persistent broadcast)
router.post('/save-playlist', verifyToken, async (req, res) => {
  try {
    const { playlist } = req.body;
    const db = await getDb();
    // Clear old playlist
    db.run('DELETE FROM playlist_songs WHERE user_id = ?', [req.user.id]);
    // Insert new
    if (playlist && playlist.length > 0) {
      playlist.forEach((song, i) => {
        db.run(
          'INSERT INTO playlist_songs (user_id, name, src, type, sort_order) VALUES (?, ?, ?, ?, ?)',
          [req.user.id, song.name, song.src, song.type || 'file', i]
        );
      });
    }
    // Also update in-memory cache for instant access on WS close
    if (playlist && playlist.length > 0) {
      savedPlaylists.set(String(req.user.id), playlist);
      console.log(`Saved playlist for user ${req.user.id}: ${playlist.length} tracks`);
    } else {
      savedPlaylists.delete(String(req.user.id));
      console.log(`Cleared playlist for user ${req.user.id}`);
    }
    res.json({ success: true, count: playlist ? playlist.length : 0 });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get saved playlist
router.get('/get-playlist', verifyToken, async (req, res) => {
  try {
    const db = await getDb();
    const songs = db.all('SELECT * FROM playlist_songs WHERE user_id = ? ORDER BY sort_order', [req.user.id]);
    res.json({ playlist: songs });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;