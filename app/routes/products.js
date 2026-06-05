'use strict';
const router = require('express').Router();
const { pool } = require('../db/database');
const { get, set, del } = require('../middleware/cache');

const PRODUCT_TTL  = parseInt(process.env.REDIS_TTL_PRODUCTS   || '300');
const CAT_TTL      = parseInt(process.env.REDIS_TTL_CATEGORIES || '3600');

const sortSQL = s => ({ price_asc: 'p.price ASC', price_desc: 'p.price DESC' }[s] || 'p.name ASC');

// GET /api/products
router.get('/', async (req, res) => {
  const { location, category, search, sort = 'name', page = '1', limit = '12', featured } = req.query;
  const ck = `products:${location||'all'}:${category||''}:${search||''}:${sort}:${page}:${limit}:${featured||''}`;
  const cached = await get(ck);
  if (cached) return res.set('X-Cache', 'HIT').json(cached);

  const conds = [], params = [];
  let i = 1;
  if (location) { params.push(location); conds.push(`(p.store_id IS NULL OR s.slug = $${i++})`); }
  else           { conds.push('p.store_id IS NULL'); }
  if (category)  { params.push(category);           conds.push(`p.category = $${i++}`); }
  if (search)    { params.push('%'+search+'%');      conds.push(`(p.name ILIKE $${i} OR p.description ILIKE $${i++})`); }
  if (featured === 'true') conds.push('p.featured = true');

  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const base  = `FROM products p LEFT JOIN stores s ON p.store_id = s.id ${where}`;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const dataParams = [...params, parseInt(limit), offset];

  try {
    const [cnt, rows] = await Promise.all([
      pool.query(`SELECT COUNT(*) ${base}`, params),
      pool.query(`SELECT p.*, s.slug as store_slug, s.name as store_name ${base} ORDER BY ${sortSQL(sort)} LIMIT $${i} OFFSET $${i+1}`, dataParams)
    ]);
    const total = parseInt(cnt.rows[0].count);
    const resp  = { products: rows.rows, meta: { total, page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(total / parseInt(limit)) } };
    await set(ck, resp, PRODUCT_TTL);
    res.set('X-Cache', 'MISS').json(resp);
  } catch(e) { console.error(e); res.status(500).json({ error: 'Failed to load products' }); }
});

// GET /api/products/categories
router.get('/categories', async (_req, res) => {
  const cached = await get('categories');
  if (cached) return res.set('X-Cache', 'HIT').json(cached);
  try {
    const { rows } = await pool.query("SELECT DISTINCT category FROM products WHERE category != '' ORDER BY category");
    const data = { categories: rows.map(r => r.category) };
    await set('categories', data, CAT_TTL);
    res.set('X-Cache', 'MISS').json(data);
  } catch(e) { res.status(500).json({ error: 'Failed to load categories' }); }
});

// GET /api/products/:slug
router.get('/:slug', async (req, res) => {
  const ck = 'product:' + req.params.slug;
  const cached = await get(ck);
  if (cached) return res.set('X-Cache', 'HIT').json(cached);
  try {
    const { rows } = await pool.query(
      'SELECT p.*, s.slug as store_slug, s.name as store_name FROM products p LEFT JOIN stores s ON p.store_id = s.id WHERE p.slug = $1',
      [req.params.slug]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
    await set(ck, rows[0], PRODUCT_TTL);
    res.set('X-Cache', 'MISS').json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Failed to load product' }); }
});

module.exports = router;
