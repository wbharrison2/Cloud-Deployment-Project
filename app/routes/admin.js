'use strict';
const router = require('express').Router();
const { pool } = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { flushAll, del } = require('../middleware/cache');
const { writeAuditLog, getClientIp } = require('../middleware/audit');
const { CloudFrontClient, CreateInvalidationCommand } = require('@aws-sdk/client-cloudfront');

router.use(requireAuth, requireAdmin);

// GET /api/admin/orders
router.get('/orders', async (req, res) => {
  const { location } = req.query;
  const params = [];
  let where = '';
  if (location) { params.push(location); where = 'WHERE s.slug=$1'; }
  try {
    const { rows } = await pool.query(
      `SELECT o.*,s.slug as store_slug,s.name as store_name
       FROM orders o LEFT JOIN stores s ON o.store_id=s.id
       ${where} ORDER BY o.created_at DESC LIMIT 500`,
      params
    );
    res.json({ orders: rows });
  } catch(e) { res.status(500).json({ error: 'Failed to load orders' }); }
});

// PATCH /api/admin/orders/:id
router.patch('/orders/:id', async (req, res) => {
  const allowed = ['pending','processing','shipped','delivered','cancelled'];
  const { status } = req.body;
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const { rows } = await pool.query(
      "UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *", [status, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    await writeAuditLog({ userId: req.user.id, userEmail: req.user.email, action: 'ORDER_STATUS_CHANGED', resourceType: 'order', resourceId: req.params.id, ipAddress: getClientIp(req), details: { status } });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Update failed' }); }
});

// GET /api/admin/products — for admin product table (full list)
router.get('/products', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT p.*,s.slug as store_slug,s.name as store_name FROM products p LEFT JOIN stores s ON p.store_id=s.id ORDER BY p.name'
    );
    res.json({ products: rows });
  } catch(e) { res.status(500).json({ error: 'Failed' }); }
});

// POST /api/admin/products
router.post('/products', async (req, res) => {
  const { slug, name, description, price, stock, category, material, featured, store_id } = req.body;
  if (!slug || !name || !price) return res.status(400).json({ error: 'slug, name, price required' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO products (slug,name,description,price,stock,category,material,featured,store_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [slug,name,description||'',price,stock||0,category||'',material||'',featured||false,store_id||null]
    );
    await del('products:*'); await del('categories');
    await writeAuditLog({ userId: req.user.id, userEmail: req.user.email, action: 'PRODUCT_CREATED', resourceType: 'product', resourceId: String(rows[0].id), ipAddress: getClientIp(req) });
    res.status(201).json(rows[0]);
  } catch(e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Slug already exists' });
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PUT /api/admin/products/:id
router.put('/products/:id', async (req, res) => {
  const { name, description, price, stock, category, material, featured, store_id } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE products SET name=$1,description=$2,price=$3,stock=$4,category=$5,material=$6,featured=$7,store_id=$8,updated_at=NOW()
       WHERE id=$9 RETURNING *`,
      [name,description||'',price,stock||0,category||'',material||'',featured||false,store_id||null,req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    await del('products:*'); await del('product:' + rows[0].slug);
    await writeAuditLog({ userId: req.user.id, userEmail: req.user.email, action: 'PRODUCT_UPDATED', resourceType: 'product', resourceId: req.params.id, ipAddress: getClientIp(req) });
    res.json(rows[0]);
  } catch(e) { res.status(500).json({ error: 'Update failed' }); }
});

// DELETE /api/admin/products/:id
router.delete('/products/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM products WHERE id=$1 RETURNING slug', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    await del('products:*'); await del('product:' + rows[0].slug);
    await writeAuditLog({ userId: req.user.id, userEmail: req.user.email, action: 'PRODUCT_DELETED', resourceType: 'product', resourceId: req.params.id, ipAddress: getClientIp(req) });
    res.json({ deleted: true });
  } catch(e) { res.status(500).json({ error: 'Delete failed' }); }
});

// GET /api/admin/audit-log
router.get('/audit-log', async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  try {
    const [cnt, rows] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM audit_log'),
      pool.query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, (page-1)*limit])
    ]);
    const total = parseInt(cnt.rows[0].count);
    res.json({ logs: rows.rows, total, page, total_pages: Math.ceil(total/limit) });
  } catch(e) { res.status(500).json({ error: 'Failed to load audit log' }); }
});

// POST /api/admin/cache/clear
router.post('/cache/clear', async (req, res) => {
  await flushAll();
  let note = '';
  if (process.env.CLOUDFRONT_DISTRIBUTION_ID) {
    try {
      const cf = new CloudFrontClient({ region: 'us-east-1' });
      await cf.send(new CreateInvalidationCommand({
        DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
        InvalidationBatch: { CallerReference: Date.now().toString(), Paths: { Quantity: 1, Items: ['/*'] } }
      }));
      note = ' + CloudFront invalidated';
    } catch(e) { note = ' (CloudFront error: ' + e.message + ')'; }
  }
  await writeAuditLog({ userId: req.user.id, userEmail: req.user.email, action: 'CACHE_CLEARED', ipAddress: getClientIp(req) });
  res.json({ message: 'Cache cleared' + note });
});

module.exports = router;
