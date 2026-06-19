const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cookieParser = require('cookie-parser');
const { getDb } = require('./database');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const broadcastRoutes = require('./routes/broadcast');
const { verifyToken, verifyAdmin } = require('./middleware/auth');

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
app.get('/signup', (req, res) => res.render('signup'));
app.get('/listen', (req, res) => res.render('listen'));
app.get('/broadcast', verifyToken, (req, res) => res.render('broadcast'));
app.get('/admin', verifyToken, verifyAdmin, (req, res) => res.render('admin'));
app.get('/admin/login', (req, res) => res.render('admin-login'));

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
      getDb().then(db => {
        db.run('UPDATE users SET is_live = 0 WHERE id = ?', [userId]);
        db.run("UPDATE broadcasts SET status = 'ended', ended_at = CURRENT_TIMESTAMP WHERE user_id = ? AND status = 'live'", [userId]);
      });

      broadcastToFrontend({
        type: 'broadcaster_offline',
        userId,
        timestamp: Date.now()
      });
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
        broadcaster.ws.send(JSON.stringify({
          type: 'listener_count',
          count: broadcaster.listeners.size
        }));
      }
    }

    ws.on('close', () => {
      if (ws.broadcasterId) {
        const broadcaster = broadcasters.get(ws.broadcasterId);
        if (broadcaster) {
          broadcaster.listeners.delete(ws);
          // Notify broadcaster
          if (broadcaster.ws.readyState === WebSocket.OPEN) {
            broadcaster.ws.send(JSON.stringify({
              type: 'listener_count',
              count: broadcaster.listeners.size
            }));
          }
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
      WHERE u.is_live = 1 AND u.role = 'broadcaster'
    `);

    res.json({
      broadcasters: liveBroadcasters.map(b => ({
        ...b,
        listeners: broadcasters.get(String(b.id))?.listeners.size || 0
      }))
    });
  } catch (error) {
    console.error('Error fetching live broadcasters:', error);
    res.json({ broadcasters: [] });
  }
});

const PORT = process.env.PORT || 3000;

async function start() {
  await getDb(); // Initialize database
  server.listen(PORT, () => {
    console.log(`FM Radio Live running on http://localhost:${PORT}`);
  });
}

start();