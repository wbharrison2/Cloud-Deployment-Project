'use strict';
const Redis = require('ioredis');

let redis = null;

function initRedis() {
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
    retryStrategy: t => Math.min(t * 100, 3000)
  });
  redis.on('error', e => console.error('Redis:', e.message));
  return redis;
}

function getRedis() { return redis; }

async function get(key) {
  if (!redis) return null;
  try { const v = await redis.get(key); return v ? JSON.parse(v) : null; } catch(e) { return null; }
}

async function set(key, value, ttl) {
  if (!redis) return;
  try { await redis.setex(key, ttl, JSON.stringify(value)); } catch(e) {}
}

async function del(pattern) {
  if (!redis) return;
  try {
    if (pattern.includes('*')) {
      const keys = await redis.keys(pattern);
      if (keys.length) await redis.del(...keys);
    } else {
      await redis.del(pattern);
    }
  } catch(e) {}
}

async function revokeToken(jti, expiresAt) {
  if (!redis) return;
  const ttl = expiresAt - Math.floor(Date.now() / 1000);
  if (ttl > 0) try { await redis.setex('blocklist:' + jti, ttl, '1'); } catch(e) {}
}

async function isTokenRevoked(jti) {
  if (!redis) return false;
  try { return !!(await redis.exists('blocklist:' + jti)); } catch(e) { return false; }
}

async function flushAll() {
  if (!redis) return 0;
  try { await redis.flushdb(); return 1; } catch(e) { return 0; }
}

module.exports = { initRedis, getRedis, get, set, del, revokeToken, isTokenRevoked, flushAll };
