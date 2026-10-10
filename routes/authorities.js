'use strict';
const express = require('express');
const { query, tx } = require('../src/db');
const { requireAuth } = require('../src/auth');
const { str, bad, HttpError, logActivity, mapAuthority } = require('../src/util');

const router = express.Router();
const KINDS = ['judgment', 'statute', 'note'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const needId = (id) => { if (!UUID.test(id)) throw new HttpError(404, 'Not found.'); return id; };

router.post('/', requireAuth, async (req, res) => {
  const b = req.body || {};
  const title = str(b.title, 160);
  if (title.length < 3) throw bad('Give it a title.');
  const kind = KINDS.includes(b.kind) ? b.kind : 'judgment';
  const year = b.year === '' || b.year == null ? null : parseInt(b.year, 10);
  if (year != null && (isNaN(year) || year < 1600 || year > 2100)) throw bad('That year does not look right.');
  try {
    const row = await tx(async (c) => {
      const r = (await c.query(
        'INSERT INTO authorities (title, kind, court, year, added_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [title, kind, str(b.court, 80), year, req.user.id])).rows[0];
      await logActivity(c, 'add', `added “${title}”`, req.user.id);
      return r;
    });
    res.status(201).json({ authority: mapAuthority(row) });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'That authority is already in the repository.');
    throw e;
  }
});

// Count one citation (the "Cite" button, or citing from a draft).
router.post('/:id/cite', requireAuth, async (req, res) => {
  const id = needId(req.params.id);
  const row = await tx(async (c) => {
    const r = (await c.query('UPDATE authorities SET citations = citations + 1 WHERE id = $1 RETURNING *', [id])).rows[0];
    if (!r) throw new HttpError(404, 'Authority not found.');
    await logActivity(c, req.body?.from === 'draft' ? 'draft' : 'cite',
      req.body?.from === 'draft' ? `cited “${r.title}” in a draft` : `cited “${r.title}”`, req.user.id);
    return r;
  });
  res.json({ authority: mapAuthority(row) });
});

// Delete: whoever added it, the admin, or anyone for sample data.
router.delete('/:id', requireAuth, async (req, res) => {
  const id = needId(req.params.id);
  await tx(async (c) => {
    const r = (await c.query('SELECT * FROM authorities WHERE id = $1', [id])).rows[0];
    if (!r) throw new HttpError(404, 'Authority not found.');
    const allowed = req.user.isAdmin || r.is_sample || r.added_by === req.user.id;
    if (!allowed) throw new HttpError(403, 'Only the member who added this can remove it.');
    await c.query('DELETE FROM authorities WHERE id = $1', [id]);
    await logActivity(c, 'delete', `removed “${r.title}”`, req.user.id);
  });
  res.json({ ok: true });
});

module.exports = router;
