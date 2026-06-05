const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');
const { cacheGet, cacheSet } = require('../middleware/cache');

router.get('/', async (req, res) => {
  try {
    const cached = await cacheGet('locations');
    if (cached) return res.set('X-Cache', 'HIT').json(cached);

    const { rows } = await pool.query(
      'SELECT id,slug,name,address,phone,hours,manager FROM stores WHERE active=true ORDER BY id');
    await cacheSet('locations', rows, 86400);
    res.set('X-Cache', 'MISS').json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

module.exports = router;
