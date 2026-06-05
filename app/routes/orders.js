const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');
const { requireAuth } = require('../middleware/auth');
const { writeAuditLog } = require('../middleware/audit');

router.get('/', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT o.*, s.name as store_name,
              json_agg(json_build_object('id',oi.id,'product_id',oi.product_id,
                'quantity',oi.quantity,'price',oi.price,'name',p.name)) as items
       FROM orders o
       LEFT JOIN stores s ON o.store_id = s.id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       LEFT JOIN products p ON oi.product_id = p.id
       WHERE o.user_id = $1
       GROUP BY o.id, s.name ORDER BY o.created_at DESC`, [req.user.id]);
    res.json(rows);
  } catch (err) {
    console.error(err); res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

router.post('/', requireAuth, async (req, res) => {
  const { items, location, customer_name, shipping_address } = req.body;
  if (!items?.length) return res.status(400).json({ error: 'Items required' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [store] } = await client.query(
      'SELECT id FROM stores WHERE slug=$1', [location || 'pdx']);
    const storeId = store?.id || null;
    let total = 0;
    const resolvedItems = [];
    for (const item of items) {
      const { rows } = await client.query(
        'SELECT id,price,stock,name FROM products WHERE id=$1 FOR UPDATE', [item.product_id]);
      const product = rows[0];
      if (!product) throw new Error(`Product ${item.product_id} not found`);
      if (product.stock < item.quantity) throw new Error(`Insufficient stock for ${product.name}`);
      total += product.price * item.quantity;
      resolvedItems.push({ ...item, price: product.price });
    }
    const { rows: [order] } = await client.query(
      `INSERT INTO orders (user_id,store_id,customer_email,customer_name,shipping_address,total)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [req.user.id, storeId, req.user.email, customer_name, JSON.stringify(shipping_address), total]);
    for (const item of resolvedItems) {
      await client.query(
        'INSERT INTO order_items (order_id,product_id,quantity,price) VALUES ($1,$2,$3,$4)',
        [order.id, item.product_id, item.quantity, item.price]);
      await client.query(
        'UPDATE products SET stock=stock-$1,updated_at=NOW() WHERE id=$2',
        [item.quantity, item.product_id]);
    }
    await client.query('COMMIT');
    await writeAuditLog(req, 'ORDER_CREATED', 'order', order.id, { total, item_count: resolvedItems.length });
    res.status(201).json({ order_id: order.id, total });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(err.message.includes('stock') ? 409 : 500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
