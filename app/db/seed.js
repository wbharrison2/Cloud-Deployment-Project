const { pool } = require('./database');
const bcrypt = require('bcryptjs');

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: [pdx] } = await client.query(`
      INSERT INTO stores (slug, name, address, phone, hours, manager)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name
      RETURNING id`,
      ['pdx', 'Artisan Gem Works Portland',
       '2847 NW Thurman St, Portland, OR 97210', '(503) 555-0142',
       JSON.stringify({ mon_fri: '10am-7pm', sat: '10am-8pm', sun: '11am-6pm' }),
       'Mira Chen']);

    const { rows: [sea] } = await client.query(`
      INSERT INTO stores (slug, name, address, phone, hours, manager)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (slug) DO UPDATE SET name=EXCLUDED.name
      RETURNING id`,
      ['sea', 'Artisan Gem Works Seattle',
       '412 Pine St, Seattle, WA 98101', '(206) 555-0187',
       JSON.stringify({ mon_fri: '10am-7pm', sat: '10am-8pm', sun: '11am-6pm' }),
       'Kenji Tanaka']);

    const shared = [
      ['sterling-silver-pendant', 'Sterling Silver Pendant Necklace', 'Hand-forged sterling silver with hammered texture', 8900, 'necklaces', true, 45],
      ['rose-gold-studs', 'Rose Gold Stud Earrings', '14k rose gold with princess-cut white topaz', 12400, 'earrings', true, 38],
      ['copper-bracelet', 'Handcrafted Copper Bracelet', 'Hammered copper with patina finish', 6700, 'bracelets', false, 22],
      ['moonstone-ring', 'Moonstone Ring', 'Sterling silver band with rainbow moonstone cabochon', 15600, 'rings', true, 18],
      ['labradorite-drops', 'Labradorite Drop Earrings', 'Sterling silver wire with oval labradorite drops', 9800, 'earrings', false, 31],
      ['turquoise-cuff', 'Turquoise Cuff Bracelet', 'Wide sterling silver cuff with natural turquoise inlay', 14300, 'bracelets', false, 14],
      ['pearl-strand', 'Pearl Strand Necklace', 'Freshwater pearl strand with sterling silver clasp', 18900, 'necklaces', true, 12],
      ['garnet-cluster-ring', 'Garnet Cluster Ring', 'Sterling silver with seven-stone garnet cluster', 21200, 'rings', false, 9],
      ['mixed-metal-set', 'Mixed Metal Earring Set', 'Set of three pairs: silver, copper, and brass', 7800, 'earrings', false, 27],
      ['amethyst-pendant', 'Amethyst Pendant', 'Raw amethyst crystal point on sterling silver bail', 13400, 'necklaces', false, 35],
    ];

    for (const [slug, name, desc, price, cat, featured, stock] of shared) {
      await client.query(
        `INSERT INTO products (slug,name,description,price,category,featured,stock,store_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NULL) ON CONFLICT (slug) DO NOTHING`,
        [slug, name, desc, price, cat, featured, stock]);
    }

    const pdxItems = [
      ['oregon-sunstone-ring', 'Oregon Sunstone Ring', 'Gold-filled band with Oregon sunstone — exclusive to Portland', 28700, 'rings', true, 7],
      ['crater-lake-topaz', 'Crater Lake Blue Topaz Necklace', 'Blue topaz inspired by Crater Lake on sterling silver chain', 19800, 'necklaces', false, 11],
      ['driftwood-copper-set', 'Pacific Driftwood Copper Set', 'Necklace + earrings set inspired by Oregon Coast driftwood', 15600, 'sets', false, 8],
    ];
    for (const [slug, name, desc, price, cat, featured, stock] of pdxItems) {
      await client.query(
        `INSERT INTO products (slug,name,description,price,category,featured,stock,store_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (slug) DO NOTHING`,
        [slug, name, desc, price, cat, featured, stock, pdx.id]);
    }

    const seaItems = [
      ['puget-aquamarine-ring', 'Puget Sound Aquamarine Ring', 'Aquamarine set in recycled silver, Seattle exclusive', 24300, 'rings', true, 9],
      ['pike-place-pendant', 'Pike Place Market Pendant', 'Bronze charm inspired by Pike Place Market fish, Seattle exclusive', 16700, 'necklaces', false, 15],
      ['cascade-jade-earrings', 'Cascade Jade Earrings', 'British Columbia nephrite jade drops, Seattle exclusive', 13400, 'earrings', false, 13],
    ];
    for (const [slug, name, desc, price, cat, featured, stock] of seaItems) {
      await client.query(
        `INSERT INTO products (slug,name,description,price,category,featured,stock,store_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (slug) DO NOTHING`,
        [slug, name, desc, price, cat, featured, stock, sea.id]);
    }

    const adminHash = await bcrypt.hash('Admin!2024Secure', 12);
    const customerHash = await bcrypt.hash('Customer!2024Demo', 12);
    await client.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1,$2,$3,'admin') ON CONFLICT (email) DO NOTHING`,
      ['admin@artisangemworks.com', adminHash, 'Mira Chen']);
    await client.query(
      `INSERT INTO users (email, password_hash, name, role)
       VALUES ($1,$2,$3,'customer') ON CONFLICT (email) DO NOTHING`,
      ['customer@demo.com', customerHash, 'Demo Customer']);

    await client.query('COMMIT');
    console.log('Seed complete: 2 stores, 16 products, 2 users');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  seed().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}

module.exports = seed;
