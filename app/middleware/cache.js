const Redis = require('ioredis');

let redis = null;

function initRedis() {
  const url = process.env.REDIS_URL;
  if (!url) { console.warn('REDIS_URL not set, caching disabled'); return; }
  redis = new Redis(url, { maxRetriesPerRequest: 3, lazyConnect: false });
  redis.on('connect', () => console.log('Redis connected'));
  redis.on('error', (err) => console.error('Redis error:', err.message));
}

function getRedis() { return redis; }

async function cacheGet(key) {
  if (!redis) return null;
  try {
    const val = await redis.get(key);
    return val ? JSON.parse(val) : null;
  } catch { return null; }
}

async function cacheSet(key, data, ttlSeconds = 300) {
  if (!redis) return;
  try { await redis.setex(key, ttlSeconds, JSON.stringify(data)); } catch { /* non-fatal */ }
}

async function cacheDel(pattern) {
  if (!redis) return;
  try {
    if (pattern.includes('*')) {
      const keys = await redis.keys(pattern);
      if (keys.length) await redis.del(...keys);
    } else {
      await redis.del(pattern);
    }
  } catch { /* non-fatal */ }
}

async function flushAll() {
  if (!redis) return;
  try { await redis.flushdb(); } catch { /* non-fatal */ }
}

async function revokeToken(jti, expiresAt) {
  if (!redis) return;
  const ttl = Math.max(0, Math.floor((expiresAt * 1000 - Date.now()) / 1000));
  try { await redis.setex(`blocklist:${jti}`, ttl, '1'); } catch { /* non-fatal */ }
}

async function isTokenRevoked(jti) {
  if (!redis) return false;
  try { return (await redis.exists(`blocklist:${jti}`)) === 1; } catch { return false; }
}

module.exports = { initRedis, getRedis, cacheGet, cacheSet, cacheDel, flushAll, revokeToken, isTokenRevoked };
