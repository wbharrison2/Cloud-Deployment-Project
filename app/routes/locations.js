'use strict';
const router = require('express').Router();
const { pool } = require('../db/database');
const { get, set } = require('../middleware/cache');

const TTL = parseInt(process.env.REDIS_TTL_LOCATIONS || '86400');

router.get('/', async (_req, res) => {
  const cached = await get('locations:all');
  if (cached) return res.set('X-Cache', 'HIT').json(cached);
  try {
    const { rows } = await pool.query('SELECT * FROM stores WHERE active = true ORDER BY id');
    const data = { locations: rows };
    await set('locations:all', data, TTL);
    res.set('X-Cache', 'MISS').json(data);
  } catch(e) { res.status(500).json({ error: 'Failed to load locations' }); }
});

module.exports = router;
