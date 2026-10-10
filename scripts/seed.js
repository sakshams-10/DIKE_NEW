'use strict';
// Optional: adds a small, clearly-labelled sample set so a fresh install isn't empty.
// Sample rows are flagged is_sample and show as "Sample data" in the app.
const { pool } = require('../src/db');
const { migrate } = require('../db/migrate');

const AUTH = [
  ['Article 21 — right to life and personal liberty', 'statute', 'Constitution of India', 1950, 14],
  ['Kesavananda Bharati v. State of Kerala', 'judgment', 'Supreme Court of India', 1973, 9],
  ['Doctrine of basic structure — note', 'note', 'Firm note', null, 5],
  ['Justice K.S. Puttaswamy (Retd.) v. Union of India', 'judgment', 'Supreme Court of India', 2017, 3]
];
const LINKS = [[3, 0], [3, 1], [2, 1]];

(async () => {
  await migrate(pool);
  const ids = [];
  for (const [title, kind, court, year, citations] of AUTH) {
    const r = await pool.query(
      `INSERT INTO authorities (title, kind, court, year, citations, is_sample) VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (lower(title)) DO UPDATE SET title = EXCLUDED.title RETURNING id`, [title, kind, court, year, citations]);
    ids.push(r.rows[0].id);
  }
  for (const [f, t] of LINKS) await pool.query('INSERT INTO links (from_id, to_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [ids[f], ids[t]]);
  console.log('Seeded', AUTH.length, 'sample authorities and', LINKS.length, 'links.');
  await pool.end();
})().catch((e) => { console.error(e.message); process.exit(1); });
