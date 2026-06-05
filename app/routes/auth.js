'use strict';
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const qrcode  = require('qrcode');
const { v4: uuidv4 } = require('uuid');
const { pool }  = require('../db/database');
const { requireAuth, setAuthCookie, clearAuthCookie } = require('../middleware/auth');
const { revokeToken } = require('../middleware/cache');
const { writeAuditLog, getClientIp } = require('../middleware/audit');

const sign = user => jwt.sign(
  { id: user.id, email: user.email, role: user.role, jti: uuidv4() },
  process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
);
const signTemp = userId => jwt.sign({ temp: true, userId }, process.env.JWT_SECRET, { expiresIn: '5m' });

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, first_name, last_name } = req.body;
  if (!email || !password || password.length < 8)
    return res.status(400).json({ error: 'Valid email and password (min 8 chars) required' });
  try {
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query(
      `INSERT INTO users (email,password_hash,first_name,last_name) VALUES ($1,$2,$3,$4)
       RETURNING id,email,first_name,last_name,role`,
      [email.toLowerCase(), hash, first_name||'', last_name||'']
    );
    setAuthCookie(res, sign(rows[0]));
    res.status(201).json({ user: rows[0] });
  } catch(e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
    const user = rows[0];
    const ip   = getClientIp(req);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      await writeAuditLog({ userEmail: email, action: 'LOGIN_FAILED', ipAddress: ip });
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.totp_enabled) {
      await writeAuditLog({ userId: user.id, userEmail: user.email, action: 'LOGIN_2FA_REQUIRED', ipAddress: ip });
      return res.json({ two_factor_required: true, temp_token: signTemp(user.id) });
    }
    setAuthCookie(res, sign(user));
    await writeAuditLog({ userId: user.id, userEmail: user.email, action: 'LOGIN_SUCCESS', ipAddress: ip });
    res.json({ user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role, totp_enabled: user.totp_enabled } });
  } catch(e) { res.status(500).json({ error: 'Login failed' }); }
});

// POST /api/auth/2fa/verify
router.post('/2fa/verify', async (req, res) => {
  const { temp_token, token } = req.body;
  if (!temp_token || !token) return res.status(400).json({ error: 'temp_token and token required' });
  try {
    const dec = jwt.verify(temp_token, process.env.JWT_SECRET);
    if (!dec.temp) return res.status(401).json({ error: 'Invalid temp token' });
    const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [dec.userId]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: 'User not found' });
    const valid = speakeasy.totp.verify({ secret: user.totp_secret, encoding: 'base32', token, window: 1 });
    if (!valid) {
      const codes = user.totp_backup_codes || [];
      const idx = codes.indexOf(token);
      if (idx === -1) return res.status(401).json({ error: 'Invalid authentication code' });
      codes.splice(idx, 1);
      await pool.query('UPDATE users SET totp_backup_codes=$1 WHERE id=$2', [JSON.stringify(codes), user.id]);
    }
    setAuthCookie(res, sign(user));
    await writeAuditLog({ userId: user.id, userEmail: user.email, action: 'LOGIN_2FA_SUCCESS', ipAddress: getClientIp(req) });
    res.json({ user: { id: user.id, email: user.email, role: user.role, totp_enabled: user.totp_enabled } });
  } catch(e) { res.status(401).json({ error: 'Verification failed' }); }
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id,email,first_name,last_name,role,totp_enabled FROM users WHERE id=$1', [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'User not found' });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Failed' }); }
});

// POST /api/auth/logout
router.post('/logout', requireAuth, async (req, res) => {
  if (req.user.jti && req.user.exp) await revokeToken(req.user.jti, req.user.exp);
  clearAuthCookie(res);
  await writeAuditLog({ userId: req.user.id, userEmail: req.user.email, action: 'LOGOUT', ipAddress: getClientIp(req) });
  res.json({ message: 'Logged out' });
});

// GET /api/auth/2fa/setup
router.get('/2fa/setup', requireAuth, async (req, res) => {
  const issuer = process.env.TOTP_ISSUER || 'Artisan Gem Works';
  const secret = speakeasy.generateSecret({ name: `${issuer} (${req.user.email})`, length: 20 });
  await pool.query('UPDATE users SET totp_secret=$1 WHERE id=$2', [secret.base32, req.user.id]);
  const qr = await qrcode.toDataURL(secret.otpauth_url);
  res.json({ secret: secret.base32, qr_code: qr });
});

// POST /api/auth/2fa/enable
router.post('/2fa/enable', requireAuth, async (req, res) => {
  const { token } = req.body;
  const { rows } = await pool.query('SELECT totp_secret FROM users WHERE id=$1', [req.user.id]);
  if (!rows[0]?.totp_secret) return res.status(400).json({ error: 'Run /2fa/setup first' });
  if (!speakeasy.totp.verify({ secret: rows[0].totp_secret, encoding: 'base32', token, window: 1 }))
    return res.status(401).json({ error: 'Invalid code' });
  const backupCodes = Array.from({ length: 8 }, () => uuidv4().split('-')[0].toUpperCase());
  await pool.query('UPDATE users SET totp_enabled=true,totp_backup_codes=$1 WHERE id=$2', [JSON.stringify(backupCodes), req.user.id]);
  await writeAuditLog({ userId: req.user.id, userEmail: req.user.email, action: '2FA_ENABLED', ipAddress: getClientIp(req) });
  res.json({ message: '2FA enabled', backup_codes: backupCodes });
});

// POST /api/auth/2fa/disable
router.post('/2fa/disable', requireAuth, async (req, res) => {
  const { token } = req.body;
  const { rows } = await pool.query('SELECT totp_secret FROM users WHERE id=$1', [req.user.id]);
  if (!rows[0]?.totp_secret) return res.status(400).json({ error: '2FA not configured' });
  if (!speakeasy.totp.verify({ secret: rows[0].totp_secret, encoding: 'base32', token, window: 1 }))
    return res.status(401).json({ error: 'Invalid code' });
  await pool.query('UPDATE users SET totp_enabled=false,totp_secret=NULL,totp_backup_codes=NULL WHERE id=$1', [req.user.id]);
  await writeAuditLog({ userId: req.user.id, userEmail: req.user.email, action: '2FA_DISABLED', ipAddress: getClientIp(req) });
  res.json({ message: '2FA disabled' });
});

module.exports = router;
