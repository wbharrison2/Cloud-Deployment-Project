const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('sslmode=require')
    ? { rejectUnauthorized: false }
    : false,
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stores (
      id SERIAL PRIMARY KEY,
      slug VARCHAR(20) UNIQUE NOT NULL,
      name VARCHAR(100) NOT NULL,
      address TEXT NOT NULL,
      phone VARCHAR(20),
      hours JSONB DEFAULT '{}',
      manager VARCHAR(100),
      active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      slug VARCHAR(100) UNIQUE NOT NULL,
      name VARCHAR(200) NOT NULL,
      description TEXT,
      price INTEGER NOT NULL,
      category VARCHAR(50) NOT NULL,
      image_url TEXT,
      stock INTEGER DEFAULT 0,
      store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL,
      featured BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(100),
      role VARCHAR(20) DEFAULT 'customer',
      totp_secret TEXT,
      totp_enabled BOOLEAN DEFAULT false,
      totp_backup_codes JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id),
      store_id INTEGER REFERENCES stores(id),
      customer_email VARCHAR(255) NOT NULL,
      customer_name VARCHAR(100),
      shipping_address JSONB,
      status VARCHAR(30) DEFAULT 'pending',
      total INTEGER NOT NULL,
      stripe_payment_intent TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id),
      quantity INTEGER NOT NULL,
      price INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      user_email VARCHAR(255),
      action VARCHAR(50) NOT NULL,
      resource_type VARCHAR(50),
      resource_id INTEGER,
      ip_address VARCHAR(45),
      user_agent TEXT,
      details JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
    CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
    CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id);
    CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at DESC);
  `);

  const { rows } = await pool.query('SELECT COUNT(*) FROM stores');
  if (parseInt(rows[0].count) === 0) {
    const { default: seed } = await import('./seed.js').catch(() => ({ default: null }));
    if (seed) await seed();
    else {
      const seed2 = require('./seed.js');
      if (typeof seed2 === 'function') await seed2();
    }
  }

  console.log('Database initialized');
}

module.exports = { pool, initDB };
