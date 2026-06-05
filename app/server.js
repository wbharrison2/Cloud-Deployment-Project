'use strict';
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const { initDB, pool } = require('./db/database');
const { initRedis, getRedis } = require('./middleware/cache');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '128kb' }));
app.use(cookieParser(process.env.COOKIE_SECRET));

const apiLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5,   standardHeaders: true });

app.use('/api/', apiLimiter);
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

app.use('/api/products',  require('./routes/products'));
app.use('/api/auth',      require('./routes/auth'));
app.use('/api/orders',    require('./routes/orders'));
app.use('/api/admin',     require('./routes/admin'));
app.use('/api/locations', require('./routes/locations'));

app.get('/api/config', (_req, res) =>
  res.json({ stripePublicKey: process.env.STRIPE_PUBLIC_KEY || '' })
);

app.get('/health', async (_req, res) => {
  let db = false, redis = false;
  try { await pool.query('SELECT 1'); db = true; } catch(e) {}
  try { const r = getRedis(); if (r) { await r.ping(); redis = true; } } catch(e) {}
  res.status(db ? 200 : 503).json({ status: db ? 'ok' : 'degraded', db: db ? 'ok' : 'error', redis: redis ? 'ok' : 'error' });
});

async function start() {
  initRedis();
  await initDB();
  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => console.log(`AGW P4 listening on :${PORT}`));
  const shutdown = async () => {
    server.close();
    const r = getRedis(); if (r) r.quit();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch(e => { console.error('Startup error:', e); process.exit(1); });
