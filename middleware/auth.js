const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fm-radio-secret-key-2024';

function verifyToken(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];

  if (!token) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.redirect('/login');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    return res.redirect('/login');
  }
}

function verifyAdmin(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];

  if (!token) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    return res.redirect('/admin/login');
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      if (req.path.startsWith('/api/')) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      return res.redirect('/');
    }
    req.user = decoded;
    next();
  } catch (error) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    return res.redirect('/admin/login');
  }
}

module.exports = { verifyToken, verifyAdmin, JWT_SECRET };