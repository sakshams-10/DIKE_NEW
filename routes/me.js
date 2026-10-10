'use strict';
const express = require('express');
const { query, tx } = require('../src/db');
const { endSession, requireAuth } = require('../src/auth');
const { str, bad, PRACTICES, mapProfile } = require('../src/util');

const router = express.Router();

// Private draft — one per member, never returned to anyone else.
router.get('/draft', requireAuth, async (req, res) => {
  const d = (await query('SELECT title, body, updated_at FROM drafts WHERE user_id = $1', [req.user.id])).rows[0];
  res.json({ title: d?.title || '', body: d?.body || '', updatedAt: d ? new Date(d.updated_at).getTime() : null });
});
router.put('/draft', requireAuth, async (req, res) => {
  const title = str(req.body?.title, 120), body = String(req.body?.body ?? '').slice(0, 200000);
  await query(`INSERT INTO drafts (user_id, title, body) VALUES ($1,$2,$3)
               ON CONFLICT (user_id) DO UPDATE SET title = $2, body = $3, updated_at = now()`, [req.user.id, title, body]);
  res.json({ ok: true });
});

router.patch('/profile', requireAuth, async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 80);
  if (name.length < 2) throw bad('Please enter your name.');
  const year = b.enrolYear === '' || b.enrolYear == null ? null : parseInt(b.enrolYear, 10);
  if (year != null && (isNaN(year) || year < 1950 || year > new Date().getFullYear())) throw bad('Enrolment year should be between 1950 and this year.');
  const practice = PRACTICES.includes(b.practice) ? b.practice : 'Other';
  const r = await query(
    'UPDATE profiles SET name=$1, practice=$2, city=$3, enrol_year=$4, is_public=$5 WHERE user_id=$6 RETURNING *',
    [name, practice, str(b.city, 60), year, b.public !== false, req.user.id]);
  res.json({ profile: mapProfile(r.rows[0]) });
});

// Deleting the account removes the profile, draft and sessions. Authorities the member
// added stay in the shared repository (their "added by" becomes anonymous).
router.delete('/account', requireAuth, async (req, res) => {
  await tx(async (c) => { await c.query('DELETE FROM users WHERE id = $1', [req.user.id]); });
  await endSession(req, res);
  res.json({ ok: true });
});

module.exports = router;
