'use strict';
const { pool, initDB } = require('./database');
const bcrypt = require('bcryptjs');

async function seed() {
  await initDB();

  await pool.query(`
    INSERT INTO stores (slug, name, address, phone, hours, manager) VALUES
    ('pdx', 'Artisan Gem Works Portland', '2847 NW Thurman St, Portland, OR 97210',
     '(503) 555-0142', '{"tue-sat":"10am–7pm","sun":"11am–5pm","mon":"Closed"}', 'Mira Chen'),
    ('sea', 'Artisan Gem Works Seattle',  '4521 Ballard Ave NW, Seattle, WA 98107',
     '(206) 555-0178', '{"mon-sat":"10am–8pm","sun":"12pm–6pm"}', 'Priya Okafor')
    ON CONFLICT (slug) DO NOTHING;
  `);

  const shared = [
    ['cascade-falls-ring','Cascade Falls Ring','Sterling silver ring inspired by Columbia River Gorge waterfalls.',14500,12,'Rings','Sterling Silver',true],
    ['forest-mist-pendant','Forest Mist Pendant','Hand-forged bronze pendant evoking morning mist in old-growth forests.',9800,18,'Pendants','Bronze',true],
    ['obsidian-coast-cuff','Obsidian Coast Cuff','Wide sterling cuff with inlaid Oregon obsidian.',17500,8,'Cuffs','Sterling Silver + Obsidian',true],
    ['pacific-tide-earrings','Pacific Tide Earrings','Wave-textured gold-fill drop earrings.',6500,24,'Earrings','Gold-Fill',false],
    ['evergreen-lariat','Evergreen Lariat','Long lariat necklace with hand-cut evergreen tree silhouette.',13000,10,'Necklaces','Sterling Silver',true],
    ['basalt-column-brooch','Basalt Column Brooch','Geometric brooch modeled on Columbia Gorge basalt formations.',8800,15,'Brooches','Sterling Silver',false],
    ['river-stone-bracelet','River Stone Bracelet','Linked bracelet with smooth river stone settings.',7500,20,'Bracelets','Sterling Silver + River Stone',false],
    ['alpine-meadow-ring','Alpine Meadow Ring','Floral cluster ring with hand-set lab sapphire.',12000,14,'Rings','Sterling Silver + Lab Sapphire',false],
    ['coastal-fog-pendant','Coastal Fog Pendant','Layered sterling pendant capturing the Pacific coastal fog.',11000,16,'Pendants','Sterling Silver',false],
    ['northwest-moss-ring','Northwest Moss Ring','Oxidized silver ring with moss agate cabochon.',8500,22,'Rings','Oxidized Silver + Moss Agate',false]
  ];
  for (const [slug,name,desc,price,stock,cat,mat,feat] of shared) {
    await pool.query(
      `INSERT INTO products (slug,name,description,price,stock,category,material,featured,store_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL) ON CONFLICT (slug) DO NOTHING`,
      [slug,name,desc,price,stock,cat,mat,feat]
    );
  }

  const { rows: [pdx] } = await pool.query("SELECT id FROM stores WHERE slug='pdx'");
  const pdxProducts = [
    ['pdx-columbia-gorge-cuff','Columbia Gorge Cuff','Wide cuff engraved with the Columbia River Gorge panorama.',16500,6,'Cuffs','Sterling Silver',true],
    ['pdx-mt-hood-crystal-set','Mt. Hood Crystal Set','Necklace + earring set with hand-cut Oregon sunstone.',22000,4,'Sets','Gold-Fill + Sunstone',true],
    ['pdx-willamette-valley-vine','Willamette Valley Vine','Delicate vine bracelet with tiny grape-leaf charms.',9500,10,'Bracelets','Sterling Silver',false]
  ];
  for (const [slug,name,desc,price,stock,cat,mat,feat] of pdxProducts) {
    await pool.query(
      `INSERT INTO products (slug,name,description,price,stock,category,material,featured,store_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (slug) DO NOTHING`,
      [slug,name,desc,price,stock,cat,mat,feat,pdx.id]
    );
  }

  const { rows: [sea] } = await pool.query("SELECT id FROM stores WHERE slug='sea'");
  const seaProducts = [
    ['sea-puget-sound-wave-ring','Puget Sound Wave Ring','Textured wave band inspired by the Puget Sound shoreline.',15500,8,'Rings','Sterling Silver',true],
    ['sea-rainier-summit-pendant','Rainier Summit Pendant','Mountain peak pendant with diamond-cut texture.',19500,5,'Pendants','White Gold-Fill',true],
    ['sea-pike-market-mosaic','Pike Market Mosaic','Colorful enamel mosaic pendant inspired by Pike Place Market.',11500,12,'Pendants','Sterling Silver + Enamel',false]
  ];
  for (const [slug,name,desc,price,stock,cat,mat,feat] of seaProducts) {
    await pool.query(
      `INSERT INTO products (slug,name,description,price,stock,category,material,featured,store_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (slug) DO NOTHING`,
      [slug,name,desc,price,stock,cat,mat,feat,sea.id]
    );
  }

  const adminHash = await bcrypt.hash('Admin!2024Secure', 12);
  await pool.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role)
     VALUES ('admin@artisangemworks.com',$1,'Mira','Chen','admin') ON CONFLICT (email) DO NOTHING`,
    [adminHash]
  );
  const custHash = await bcrypt.hash('Customer!2024Demo', 12);
  await pool.query(
    `INSERT INTO users (email,password_hash,first_name,last_name,role)
     VALUES ('customer@demo.com',$1,'Alex','Rivera','customer') ON CONFLICT (email) DO NOTHING`,
    [custHash]
  );

  console.log('Seed complete: 2 stores, 16 products, 2 users');
  await pool.end();
}

seed().catch(e => { console.error('Seed failed:', e); process.exit(1); });
