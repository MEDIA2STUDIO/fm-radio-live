const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const { getDb, setupShutdownHandlers } = require('./database');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const broadcastRoutes = require('./routes/broadcast');
const { verifyToken, verifyAdmin } = require('./middleware/auth');
const { PersistentBroadcast, persistentBroadcasts, savedPlaylists } = require('./persistent-broadcast');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/broadcast', broadcastRoutes);

// Pages
app.get('/', (req, res) => res.render('index'));
app.get('/login', (req, res) => res.render('login'));
app.get('/listen', (req, res) => res.render('listen'));
app.get('/broadcast', verifyToken, (req, res) => res.render('broadcast'));
app.get('/admin', verifyToken, verifyAdmin, (req, res) => res.render('admin'));
app.get('/admin/login', (req, res) => res.render('admin-login'));

// Multer config for MP3 upload (local filesystem storage)
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage, fileFilter: (req, file, cb) => {
  if (file.mimetype.includes('audio') || file.originalname.endsWith('.mp3')) cb(null, true);
  else cb(new Error('Only audio files allowed'), false);
}});

// Broadcasters tracking
const broadcasters = new Map();

// WebSocket handling
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const type = url.searchParams.get('type');
  const userId = url.searchParams.get('userId');

  console.log(`WebSocket connected: type=${type}, userId=${userId}`);

  if (type === 'broadcaster' && userId) {
    // Register broadcaster
    broadcasters.set(userId, {
      ws,
      userId,
      startTime: Date.now(),
      listeners: new Set()
    });

    // Update database
    getDb().then(db => {
      db.run('UPDATE users SET is_live = 1 WHERE id = ?', [userId]);
      db.run("INSERT INTO broadcasts (user_id, status) VALUES (?, 'live')", [userId]);
    });

    // Notify all listeners
    broadcastToFrontend({
      type: 'broadcaster_online',
      userId,
      timestamp: Date.now()
    });

    ws.on('message', (data) => {
      const broadcaster = broadcasters.get(userId);
      if (broadcaster) {
        broadcaster.listeners.forEach(listenerWs => {
          if (listenerWs.readyState === WebSocket.OPEN) {
            listenerWs.send(data);
          }
        });
      }
    });
    ws.on('close', () => {
      broadcasters.delete(userId);
      console.log(`Broadcaster ${userId} disconnected`);

      // Notify frontend
      broadcastToFrontend({
        type: 'broadcaster_offline',
        userId,
        timestamp: Date.now()
      });

      // Check in-memory cache for saved playlist → persist immediately
      const cachedPlaylist = savedPlaylists.get(userId);
      if (cachedPlaylist && cachedPlaylist.length > 0 && !persistentBroadcasts.has(userId)) {
        console.log(`Starting persistent broadcast for user ${userId} (${cachedPlaylist.length} tracks)`);
        const pb = new PersistentBroadcast(userId, cachedPlaylist, wss);
        pb.start();

        // Re-attach any listeners that were connected to this broadcaster
        wss.clients.forEach(client => {
          if (client.readyState === WebSocket.OPEN && client.broadcasterId == userId) {
            pb.addListener(client);
          }
        });

        // Update DB: keep user live
        getDb().then(db => {
          db.run('UPDATE users SET is_live = 1 WHERE id = ?', [userId]);
        });
      } else {
        console.log(`No saved playlist for user ${userId}, broadcast ended`);
        // No playlist saved → mark offline
        getDb().then(db => {
          db.run('UPDATE users SET is_live = 0 WHERE id = ?', [userId]);
          db.run("UPDATE broadcasts SET status = 'ended', ended_at = CURRENT_TIMESTAMP WHERE user_id = ? AND status = 'live'", [userId]);
        });
      }
    });
  }

  if (type === 'listener') {
    const broadcasterId = url.searchParams.get('broadcasterId');

    if (broadcasterId) {
      const broadcaster = broadcasters.get(broadcasterId);
      if (broadcaster) {
        broadcaster.listeners.add(ws);
        ws.broadcasterId = broadcasterId;

        ws.send(JSON.stringify({
          type: 'listener_count',
          count: broadcaster.listeners.size
        }));

        // Notify broadcaster of new listener
        if (broadcaster.ws && broadcaster.ws.readyState === WebSocket.OPEN) {
          broadcaster.ws.send(JSON.stringify({
            type: 'listener_count',
            count: broadcaster.listeners.size
          }));
        }
      } else {
        // Check if there's a persistent broadcast for this broadcaster
        const pb = persistentBroadcasts.get(broadcasterId);
        if (pb) {
          pb.addListener(ws);
          ws.broadcasterId = broadcasterId;
          ws.isPersistentListener = true;
          ws.send(JSON.stringify({ type: 'listener_count', count: pb.listeners.size }));
        }
      }
    }

    ws.on('close', () => {
      if (ws.broadcasterId) {
        const broadcaster = broadcasters.get(ws.broadcasterId);
        if (broadcaster) {
          broadcaster.listeners.delete(ws);
          // Notify broadcaster
          if (broadcaster.ws && broadcaster.ws.readyState === WebSocket.OPEN) {
            broadcaster.ws.send(JSON.stringify({
              type: 'listener_count',
              count: broadcaster.listeners.size
            }));
          }
        }
        // Also remove from persistent broadcast if connected
        const pb = persistentBroadcasts.get(ws.broadcasterId);
        if (pb) {
          pb.removeListener(ws);
        }
      }
    });
  }
});

function broadcastToFrontend(data) {
  const msg = typeof data === 'string' ? data : JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// API to get live broadcasters
app.get('/api/live', async (req, res) => {
  try {
    const db = await getDb();
    const liveBroadcasters = db.all(`
      SELECT u.id, u.username, u.display_name, u.location, u.avatar
      FROM users u
      WHERE (u.is_live = 1 OR u.id IN (SELECT user_id FROM playlist_songs WHERE user_id = u.id)) AND u.role = 'broadcaster'
    `);

    res.json({
      broadcasters: liveBroadcasters.map(b => ({
        ...b,
        listeners: broadcasters.get(String(b.id))?.listeners.size || persistentBroadcasts.get(String(b.id))?.listeners.size || 0
      }))
    });
  } catch (error) {
    console.error('Error fetching live broadcasters:', error);
    res.json({ broadcasters: [] });
  }
});

// TTS proxy endpoint (free, no API key needed)
app.get('/api/tts', async (req, res) => {
  try {
    const text = req.query.text;
    const lang = req.query.lang || 'ta';
    if (!text) return res.status(400).json({ error: 'Text required' });

    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${encodeURIComponent(lang)}&client=tw-ob`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' }
    });
    if (!response.ok) return res.status(502).json({ error: 'TTS failed' });

    const audioBuffer = await response.arrayBuffer();
    res.set('Content-Type', 'audio/mpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(audioBuffer));
  } catch (error) {
    console.error('TTS error:', error.message);
    res.status(500).json({ error: 'TTS failed' });
  }
});

// File upload endpoint (local filesystem)
app.post('/api/upload', verifyToken, (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ success: true, path: '/uploads/' + req.file.filename, name: req.file.originalname });
  });
});

// Get persistent broadcast status for current user
app.get('/api/broadcast/persist-status', verifyToken, async (req, res) => {
  const pb = persistentBroadcasts.get(String(req.user.id));
  if (pb && pb.active) {
    res.json({ active: true, ...pb.getStatus() });
  } else {
    // Check in-memory cache
    const cached = savedPlaylists.get(String(req.user.id));
    res.json({ active: false, hasSavedPlaylist: !!cached && cached.length > 0 });
  }
});

// Stop persistent broadcast
app.post('/api/broadcast/persist-stop', verifyToken, async (req, res) => {
  const pb = persistentBroadcasts.get(String(req.user.id));
  if (pb) pb.stop();
  savedPlaylists.delete(String(req.user.id));
  const db = await getDb();
  db.run('DELETE FROM persistent_broadcasts WHERE user_id = ?', [req.user.id]);
  db.run('DELETE FROM playlist_songs WHERE user_id = ?', [req.user.id]);
  db.run('UPDATE users SET is_live = 0 WHERE id = ?', [req.user.id]);
  db.run("UPDATE broadcasts SET status = 'ended', ended_at = CURRENT_TIMESTAMP WHERE user_id = ? AND status = 'live'", [req.user.id]);
  res.json({ success: true });
});

// Take over persistent broadcast
app.post('/api/broadcast/take-over', verifyToken, async (req, res) => {
  const pb = persistentBroadcasts.get(String(req.user.id));
  if (pb) pb.stop();
  // Don't clear savedPlaylists - the client will reload it
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;

async function start() {
  await getDb(); // Initialize database
  setupShutdownHandlers();
  server.listen(PORT, () => {
    console.log(`FM Radio Live running on http://localhost:${PORT}`);
  });
}

start();