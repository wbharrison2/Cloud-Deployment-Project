const express = require('express');
const router = express.Router();
const { CloudFrontClient, CreateInvalidationCommand } = require('@aws-sdk/client-cloudfront');
const { pool } = require('../db/database');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { cacheDel, flushAll } = require('../middleware/cache');
const { writeAuditLog } = require('../middleware/audit');

router.use(requireAuth, requireAdmin);

router.get('/products', async (req, res) => {
  try {
    const { location } = req.query;
    let sql = `SELECT p.*,s.slug as store_slug,s.name as store_name
               FROM products p LEFT JOIN stores s ON p.store_id=s.id`;
    const params = [];
    if (location && location !== 'all') {
      params.push(location);
      sql += ` WHERE (p.store_id IS NULL OR s.slug=$1)`;
    }
    sql += ' ORDER BY p.created_at DESC';
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to fetch products' });
  }
});

router.post('/products', async (req, res) => {
  const { name, slug, description, price, category, image_url, stock, store_id, featured } = req.body;
  if (!name || !slug || !price || !category) return res.status(400).json({ error: 'Required fields missing' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO products (name,slug,description,price,category,image_url,stock,store_id,featured)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [name, slug, description, price, category, image_url, stock || 0, store_id || null, featured || false]);
    await cacheDel('products:*');
    await writeAuditLog(req, 'PRODUCT_CREATED', 'product', rows[0].id, { name });
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to create product' });
  }
});

router.put('/products/:id', async (req, res) => {
  const { name, description, price, category, image_url, stock, store_id, featured } = req.body;
  try {
    const { rows } = await pool.query(
      `UPDATE products SET name=$1,description=$2,price=$3,category=$4,image_url=$5,
       stock=$6,store_id=$7,featured=$8,updated_at=NOW() WHERE id=$9 RETURNING *`,
      [name, description, price, category, image_url, stock, store_id || null, featured, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
    await cacheDel('products:*');
    await cacheDel(`product:${rows[0].slug}`);
    await writeAuditLog(req, 'PRODUCT_UPDATED', 'product', rows[0].id, { name });
    res.json(rows[0]);
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to update product' });
  }
});

router.delete('/products/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('DELETE FROM products WHERE id=$1 RETURNING *', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Product not found' });
    await cacheDel('products:*');
    await writeAuditLog(req, 'PRODUCT_DELETED', 'product', rows[0].id, { name: rows[0].name });
    res.json({ message: 'Product deleted' });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to delete product' });
  }
});

router.get('/orders', async (req, res) => {
  try {
    const { location, status } = req.query;
    const params = [];
    let where = 'WHERE 1=1';
    if (location && location !== 'all') { params.push(location); where += ` AND s.slug=$${params.length}`; }
    if (status) { params.push(status); where += ` AND o.status=$${params.length}`; }
    const { rows } = await pool.query(
      `SELECT o.*,s.slug as store_slug,s.name as store_name,
              json_agg(json_build_object('id',oi.id,'name',p.name,'quantity',oi.quantity,'price',oi.price)) as items
       FROM orders o LEFT JOIN stores s ON o.store_id=s.id
       LEFT JOIN order_items oi ON oi.order_id=o.id
       LEFT JOIN products p ON oi.product_id=p.id
       ${where} GROUP BY o.id,s.slug,s.name ORDER BY o.created_at DESC`, params);
    res.json(rows);
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

router.put('/orders/:id/status', async (req, res) => {
  const { status } = req.body;
  const valid = ['pending','processing','shipped','delivered','cancelled'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  try {
    const { rows } = await pool.query(
      'UPDATE orders SET status=$1,updated_at=NOW() WHERE id=$2 RETURNING *', [status, req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Order not found' });
    await writeAuditLog(req, 'ORDER_STATUS_CHANGED', 'order', rows[0].id, { status });
    res.json(rows[0]);
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to update order' });
  }
});

router.post('/cache/clear', async (req, res) => {
  try {
    await flushAll();
    if (process.env.CLOUDFRONT_DISTRIBUTION_ID) {
      const cf = new CloudFrontClient({ region: process.env.AWS_REGION || 'us-east-1' });
      await cf.send(new CreateInvalidationCommand({
        DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID,
        InvalidationBatch: { CallerReference: Date.now().toString(), Paths: { Quantity: 1, Items: ['/*'] } },
      }));
    }
    await writeAuditLog(req, 'CACHE_CLEARED', 'system', null);
    res.json({ message: 'Cache cleared' });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to clear cache' });
  }
});

router.get('/audit-log', async (req, res) => {
  const { page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  try {
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        'SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [parseInt(limit), offset]),
      pool.query('SELECT COUNT(*) FROM audit_log'),
    ]);
    res.json({ logs: rows, total: parseInt(countRows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

module.exports = router;
