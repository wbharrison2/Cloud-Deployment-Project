'use strict';
const jwt = require('jsonwebtoken');
const { isTokenRevoked } = require('./cache');

const IS_PROD   = process.env.NODE_ENV === 'production';
const COOKIE_NAME = IS_PROD ? '__Host-agw_token' : 'agw_token';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'strict',
  path: '/',
  ...(IS_PROD ? { secure: true } : {})
};

function extractToken(req) {
  if (req.cookies?.[COOKIE_NAME]) return req.cookies[COOKIE_NAME];
  const auth = req.headers.authorization;
  if (auth?.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

async function requireAuth(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.jti && await isTokenRevoked(decoded.jti)) {
      return res.status(401).json({ error: 'Session revoked' });
    }
    req.user = decoded;
    next();
  } catch(e) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin')
    return res.status(403).json({ error: 'Admin access required' });
  next();
}

function setAuthCookie(res, token) { res.cookie(COOKIE_NAME, token, COOKIE_OPTS); }
function clearAuthCookie(res)       { res.clearCookie(COOKIE_NAME, { ...COOKIE_OPTS, maxAge: 0 }); }

module.exports = { requireAuth, requireAdmin, setAuthCookie, clearAuthCookie };
