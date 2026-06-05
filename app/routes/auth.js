const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../db/database');
const { requireAuth, requireAdmin, COOKIE_NAME } = require('../middleware/auth');
const { revokeToken } = require('../middleware/cache');
const { writeAuditLog } = require('../middleware/audit');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';
const COOKIE_SECURE = process.env.COOKIE_SECURE !== 'false';
const COOKIE_SAMESITE = process.env.COOKIE_SAMESITE || 'strict';

function makeToken(user, extra = {}) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, jti: uuidv4(), ...extra },
    JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function setCookie(res, token) {
  const maxAge = 7 * 24 * 60 * 60 * 1000;
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true, secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE,
    maxAge, path: '/',
  });
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email.toLowerCase()]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      await writeAuditLog(req, 'LOGIN_FAILED', 'user', null, { email });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.totp_enabled) {
      const tempToken = jwt.sign(
        { id: user.id, email: user.email, role: user.role, twofa_pending: true, jti: uuidv4() },
        JWT_SECRET, { expiresIn: '5m' });
      return res.json({ two_factor_required: true, temp_token: tempToken });
    }
    const token = makeToken(user);
    setCookie(res, token);
    await writeAuditLog(req, 'LOGIN_SUCCESS', 'user', user.id, { email: user.email });
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/2fa/verify', async (req, res) => {
  const { temp_token, code } = req.body;
  if (!temp_token || !code) return res.status(400).json({ error: 'temp_token and code required' });
  try {
    const payload = jwt.verify(temp_token, JWT_SECRET);
    if (!payload.twofa_pending) return res.status(400).json({ error: 'Invalid temp token' });
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [payload.id]);
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });
    const valid = speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: code, window: 2 });
    if (!valid) {
      const backup = (user.totp_backup_codes || []);
      const idx = backup.indexOf(code);
      if (idx === -1) return res.status(401).json({ error: 'Invalid 2FA code' });
      backup.splice(idx, 1);
      await pool.query('UPDATE users SET totp_backup_codes=$1 WHERE id=$2', [JSON.stringify(backup), user.id]);
    }
    const token = makeToken(user);
    setCookie(res, token);
    await writeAuditLog(req, 'LOGIN_SUCCESS', 'user', user.id, { email: user.email, method: '2fa' });
    res.json({ user: { id: user.id, email: user.email, name: user.name, role: user.role } });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired temp token' });
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  try {
    await revokeToken(req.user.jti, req.user.exp);
    await writeAuditLog(req, 'LOGOUT', 'user', req.user.id);
    res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: COOKIE_SECURE, sameSite: COOKIE_SAMESITE, path: '/' });
    res.json({ message: 'Logged out' });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Logout failed' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,email,name,role,totp_enabled FROM users WHERE id=$1', [req.user.id]);
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json({ user: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

router.post('/2fa/setup', requireAuth, requireAdmin, async (req, res) => {
  try {
    const secret = speakeasy.generateSecret({ name: `Artisan Gem Works (${req.user.email})`, length: 32 });
    await pool.query('UPDATE users SET totp_secret=$1 WHERE id=$2', [secret.base32, req.user.id]);
    const qrUrl = await qrcode.toDataURL(secret.otpauth_url);
    res.json({ qr_code: qrUrl, secret: secret.base32 });
  } catch (err) {
    res.status(500).json({ error: 'Failed to setup 2FA' });
  }
});

router.post('/2fa/enable', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { code } = req.body;
    const { rows } = await pool.query('SELECT totp_secret FROM users WHERE id=$1', [req.user.id]);
    if (!rows[0]?.totp_secret) return res.status(400).json({ error: '2FA not set up' });
    const valid = speakeasy.totp.verify({ secret: rows[0].totp_secret, encoding: 'base32', token: code, window: 2 });
    if (!valid) return res.status(401).json({ error: 'Invalid code' });
    const backupCodes = Array.from({ length: 8 }, () => Math.random().toString(36).substring(2, 10).toUpperCase());
    await pool.query(
      'UPDATE users SET totp_enabled=true, totp_backup_codes=$1 WHERE id=$2',
      [JSON.stringify(backupCodes), req.user.id]);
    await writeAuditLog(req, '2FA_ENABLED', 'user', req.user.id);
    res.json({ message: '2FA enabled', backup_codes: backupCodes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to enable 2FA' });
  }
});

router.post('/2fa/disable', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { code } = req.body;
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const user = rows[0];
    if (!user?.totp_enabled) return res.status(400).json({ error: '2FA not enabled' });
    const valid = speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token: code, window: 2 });
    if (!valid) return res.status(401).json({ error: 'Invalid code' });
    await pool.query('UPDATE users SET totp_enabled=false, totp_secret=NULL, totp_backup_codes=$1 WHERE id=$2',
      [JSON.stringify([]), req.user.id]);
    await writeAuditLog(req, '2FA_DISABLED', 'user', req.user.id);
    res.json({ message: '2FA disabled' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disable 2FA' });
  }
});

module.exports = router;
