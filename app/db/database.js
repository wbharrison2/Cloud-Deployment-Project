'use strict';
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '10'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', err => console.error('DB pool error:', err.message));

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS stores (
        id         SERIAL PRIMARY KEY,
        slug       TEXT UNIQUE NOT NULL,
        name       TEXT NOT NULL,
        address    TEXT,
        phone      TEXT,
        hours      JSONB DEFAULT '{}',
        manager    TEXT,
        active     BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS products (
        id          SERIAL PRIMARY KEY,
        slug        TEXT UNIQUE NOT NULL,
        name        TEXT NOT NULL,
        description TEXT DEFAULT '',
        price       INTEGER NOT NULL,
        stock       INTEGER DEFAULT 0,
        category    TEXT DEFAULT '',
        material    TEXT DEFAULT '',
        featured    BOOLEAN DEFAULT false,
        store_id    INTEGER REFERENCES stores(id) ON DELETE SET NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS users (
        id                 SERIAL PRIMARY KEY,
        email              TEXT UNIQUE NOT NULL,
        password_hash      TEXT NOT NULL,
        first_name         TEXT DEFAULT '',
        last_name          TEXT DEFAULT '',
        role               TEXT DEFAULT 'customer',
        totp_secret        TEXT,
        totp_enabled       BOOLEAN DEFAULT false,
        totp_backup_codes  JSONB DEFAULT '[]',
        created_at         TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS orders (
        id               SERIAL PRIMARY KEY,
        user_id          INTEGER REFERENCES users(id),
        store_id         INTEGER REFERENCES stores(id),
        customer_email   TEXT,
        customer_name    TEXT,
        shipping_address TEXT,
        status           TEXT DEFAULT 'pending',
        total            INTEGER DEFAULT 0,
        created_at       TIMESTAMPTZ DEFAULT NOW(),
        updated_at       TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS order_items (
        id         SERIAL PRIMARY KEY,
        order_id   INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id),
        quantity   INTEGER NOT NULL,
        price      INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER,
        user_email    TEXT,
        action        TEXT NOT NULL,
        resource_type TEXT,
        resource_id   TEXT,
        ip_address    TEXT,
        user_agent    TEXT,
        details       JSONB,
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_products_store    ON products(store_id);
      CREATE INDEX IF NOT EXISTS idx_products_slug     ON products(slug);
      CREATE INDEX IF NOT EXISTS idx_orders_store      ON orders(store_id);
      CREATE INDEX IF NOT EXISTS idx_orders_user       ON orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_audit_created_at  ON audit_log(created_at DESC);
    `);
    console.log('Database schema ready');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
