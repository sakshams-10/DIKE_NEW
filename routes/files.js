'use strict';
const express = require('express');
const { query, tx } = require('../src/db');
const config = require('../src/config');
const { requireAuth } = require('../src/auth');
const { bad, HttpError, logActivity, mapFile } = require('../src/util');

const router = express.Router();
const TYPES = { pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Upload: raw bytes in the body, original name in the X-Filename header (URI-encoded).
router.post('/', requireAuth, express.raw({ type: () => true, limit: config.maxFileBytes }), async (req, res) => {
  let name = '';
  try { name = decodeURIComponent(req.get('x-filename') || ''); } catch (_) {}
  name = name.replace(/[\\/\0]/g, '_').trim().slice(0, 160);
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (!name || !TYPES[ext]) throw bad('That file type isn\'t supported. Try PDF, text, Markdown, CSV, JSON or an image.');
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw bad('That file is empty.');
  const row = await tx(async (c) => {
    const r = (await c.query('INSERT INTO files (name, size, type, data, by) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, size, type, by, at',
      [name, req.body.length, TYPES[ext], req.body, req.user.id])).rows[0];
    await logActivity(c, 'upload', `uploaded ${name}`, req.user.id);
    return r;
  });
  res.status(201).json({ file: mapFile(row) });
});

// Download (signed-in members only). Always sent as an attachment with a fixed type so
// an uploaded file can never run as a page on this origin.
router.get('/:id', requireAuth, async (req, res) => {
  if (!UUID.test(req.params.id)) throw new HttpError(404, 'Not found.');
  const f = (await query('SELECT name, type, data FROM files WHERE id = $1', [req.params.id])).rows[0];
  if (!f) throw new HttpError(404, 'File not found.');
  res.set({
    'Content-Type': f.type,
    'Content-Disposition': `${f.type === 'application/pdf' || f.type.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox"
  });
  res.send(f.data);
});

router.delete('/:id', requireAuth, async (req, res) => {
  if (!UUID.test(req.params.id)) throw new HttpError(404, 'Not found.');
  await tx(async (c) => {
    const f = (await c.query('SELECT id, name, by FROM files WHERE id = $1', [req.params.id])).rows[0];
    if (!f) throw new HttpError(404, 'File not found.');
    if (!req.user.isAdmin && f.by !== req.user.id) throw new HttpError(403, 'Only the uploader can delete this.');
    await c.query('DELETE FROM files WHERE id = $1', [f.id]);
    await logActivity(c, 'delete', `removed file ${f.name}`, req.user.id);
  });
  res.json({ ok: true });
});

module.exports = router;
