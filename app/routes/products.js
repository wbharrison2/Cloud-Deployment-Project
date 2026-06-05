const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');
const { cacheGet, cacheSet } = require('../middleware/cache');

router.get('/', async (req, res) => {
  const { location, category, search, sort = 'created_at', page = 1, limit = 12 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const cacheKey = `products:${location||'all'}:${category||'all'}:${search||''}:${sort}:${page}`;

  try {
    const cached = await cacheGet(cacheKey);
    if (cached) return res.set('X-Cache', 'HIT').json(cached);

    const params = [];
    let where = 'WHERE 1=1';

    if (location) {
      params.push(location);
      where += ` AND (p.store_id IS NULL OR s.slug = $${params.length})`;
    } else {
      where += ' AND p.store_id IS NULL';
    }
    if (category) { params.push(category); where += ` AND p.category = $${params.length}`; }
    if (search) { params.push(`%${search}%`); where += ` AND (p.name ILIKE $${params.length} OR p.description ILIKE $${params.length})`; }

    const allowed = { price_asc: 'p.price ASC', price_desc: 'p.price DESC', name_asc: 'p.name ASC', created_at: 'p.created_at DESC' };
    const orderBy = allowed[sort] || 'p.created_at DESC';

    params.push(parseInt(limit)); const limitIdx = params.length;
    params.push(offset); const offsetIdx = params.length;

    const sql = `
      SELECT p.*, s.slug as store_slug, s.name as store_name
      FROM products p LEFT JOIN stores s ON p.store_id = s.id
      ${where} ORDER BY ${orderBy} LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

    const countSql = `SELECT COUNT(*) FROM products p LEFT JOIN stores s ON p.store_id = s.id ${where}`;
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(sql, params),
      pool.query(countSql, params.slice(0, -2)),
    ]);

    const result = { products: rows, total: parseInt(countRows[0].count), page: parseInt(page), limit: parseInt(limit) };
    await cacheSet(cacheKey, result, 300);
    res.set('X-Cache', 'MISS').json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
});

router.get('/:slug', async (req, res) => {
  try {
    const cacheKey = `product:${req.params.slug}`;
    const cached = await cacheGet(cacheKey);
    if (cached) return res.set('X-Cache', 'HIT').json(cached);

    const { rows } = await pool.query(
      `SELECT p.*, s.slug as store_slug, s.name as store_name
       FROM products p LEFT JOIN stores s ON p.store_id = s.id
       WHERE p.slug = $1`, [req.params.slug]);
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
    await cacheSet(cacheKey, rows[0], 600);
    res.set('X-Cache', 'MISS').json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const cached = await cacheGet('categories');
    if (cached) return res.set('X-Cache', 'HIT').json(cached);
    const { rows } = await pool.query(
      'SELECT DISTINCT category FROM products ORDER BY category');
    const cats = rows.map(r => r.category);
    await cacheSet('categories', cats, 3600);
    res.set('X-Cache', 'MISS').json(cats);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

module.exports = router;
