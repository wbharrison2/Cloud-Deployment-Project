const jwt = require('jsonwebtoken');
const { isTokenRevoked } = require('./cache');

const COOKIE_NAME = process.env.COOKIE_NAME || 'agw_token';
const JWT_SECRET = process.env.JWT_SECRET;

async function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (await isTokenRevoked(payload.jti)) {
      return res.status(401).json({ error: 'Session revoked' });
    }
    req.user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin, COOKIE_NAME };
