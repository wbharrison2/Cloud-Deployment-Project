'use strict';
const router = require('express').Router();
const { pool } = require('../db/database');
const { requireAuth } = require('../middleware/auth');

// POST /api/orders
router.post('/', async (req, res) => {
  const { items, customer_email, customer_name, shipping_address, location } = req.body;
  if (!items?.length || !customer_email)
    return res.status(400).json({ error: 'items and customer_email required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let storeId = null;
    if (location) {
      const { rows } = await client.query('SELECT id FROM stores WHERE slug=$1', [location]);
      storeId = rows[0]?.id || null;
    }
    const total = items.reduce((s, i) => s + i.price * i.quantity, 0);
    const { rows: [order] } = await client.query(
      `INSERT INTO orders (user_id,store_id,customer_email,customer_name,shipping_address,total)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.user?.id || null, storeId, customer_email, customer_name||'', shipping_address||'', total]
    );
    for (const item of items) {
      await client.query(
        'INSERT INTO order_items (order_id,product_id,quantity,price) VALUES ($1,$2,$3,$4)',
        [order.id, item.product_id, item.quantity, item.price]
      );
      await client.query(
        'UPDATE products SET stock=stock-$1 WHERE id=$2 AND stock>=$1',
        [item.quantity, item.product_id]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ order_id: order.id, total });
  } catch(e) {
    await client.query('ROLLBACK');
    console.error(e);
    res.status(500).json({ error: 'Order placement failed' });
  } finally { client.release(); }
});

// GET /api/orders/mine
router.get('/mine', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*,s.name as store_name,s.slug as store_slug
       FROM orders o LEFT JOIN stores s ON o.store_id=s.id
       WHERE o.user_id=$1 ORDER BY o.created_at DESC`,
      [req.user.id]
    );
    res.json({ orders: rows });
  } catch(e) { res.status(500).json({ error: 'Failed to load orders' }); }
});

module.exports = router;
