'use strict';
const fs = require('fs');
const path = require('path');

async function migrate(pool) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}
module.exports = { migrate };

if (require.main === module) {
  const { pool } = require('../src/db');
  migrate(pool)
    .then(() => { console.log('Schema is up to date.'); return pool.end(); })
    .catch((e) => { console.error('Migration failed:', e.message); process.exit(1); });
}
