'use strict';
const express = require('express');
const { tx } = require('../src/db');
const { requireAuth } = require('../src/auth');
const { bad, HttpError, logActivity, mapLink } = require('../src/util');

const router = express.Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "from" cites "to"
router.post('/', requireAuth, async (req, res) => {
  const from = String(req.body?.from || ''), to = String(req.body?.to || '');
  if (!UUID.test(from) || !UUID.test(to)) throw bad('Choose two authorities.');
  if (from === to) throw bad('An authority cannot cite itself.');
  try {
    const row = await tx(async (c) => {
      const a = (await c.query('SELECT id, title FROM authorities WHERE id = ANY($1)', [[from, to]])).rows;
      const A = a.find((x) => x.id === from), B = a.find((x) => x.id === to);
      if (!A || !B) throw new HttpError(404, 'Authority not found.');
      const r = (await c.query('INSERT INTO links (from_id, to_id, by) VALUES ($1,$2,$3) RETURNING *', [from, to, req.user.id])).rows[0];
      await logActivity(c, 'link', `linked “${A.title}” → “${B.title}”`, req.user.id);
      return r;
    });
    res.status(201).json({ link: mapLink(row) });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'Those two are already linked.');
    throw e;
  }
});

router.delete('/:id', requireAuth, async (req, res) => {
  if (!UUID.test(req.params.id)) throw new HttpError(404, 'Not found.');
  await tx(async (c) => {
    const r = (await c.query('DELETE FROM links WHERE id = $1 RETURNING id', [req.params.id])).rows[0];
    if (!r) throw new HttpError(404, 'Link not found.');
    await logActivity(c, 'link', 'removed a citation link', req.user.id);
  });
  res.json({ ok: true });
});

module.exports = router;
