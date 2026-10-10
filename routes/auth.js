'use strict';
const express = require('express');
const { query, tx } = require('../src/db');
const config = require('../src/config');
const { hashPassword, verifyPassword, startSession, endSession, requireAuth } = require('../src/auth');
const { EMAIL_RE, str, bad, HttpError, logActivity, PRACTICES } = require('../src/util');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 80), email = str(b.email, 120).toLowerCase(), password = String(b.password || '');
  const year = b.enrolYear === '' || b.enrolYear == null ? null : parseInt(b.enrolYear, 10);
  if (name.length < 2) throw bad('Please enter your full name.');
  if (!EMAIL_RE.test(email)) throw bad('Please enter a valid email address.');
  if (password.length < 8) throw bad('Password must be at least 8 characters.');
  if (password.length > 200) throw bad('Password is too long.');
  if (year != null && (isNaN(year) || year < 1950 || year > new Date().getFullYear())) throw bad('Enrolment year should be between 1950 and this year.');
  if (!b.consent) throw bad('Please confirm you understand what is stored.');
  const practice = PRACTICES.includes(b.practice) ? b.practice : 'Other';

  const hash = await hashPassword(password);
  let userId;
  try {
    userId = await tx(async (c) => {
      const first = (await c.query('SELECT count(*)::int AS n FROM users')).rows[0].n === 0;
      const admin = first && !config.adminEmail ? true : email === config.adminEmail;
      const { rows } = await c.query('INSERT INTO users (email, password_hash, is_admin) VALUES ($1,$2,$3) RETURNING id', [email, hash, admin]);
      await c.query('INSERT INTO profiles (user_id, name, practice, city, enrol_year, is_public) VALUES ($1,$2,$3,$4,$5,$6)',
        [rows[0].id, name, practice, str(b.city, 60), year, b.public !== false]);
      await logActivity(c, 'join', 'joined DÍKĒ', rows[0].id);
      return rows[0].id;
    });
  } catch (e) {
    if (e.code === '23505') throw new HttpError(409, 'An account with that email already exists.');
    throw e;
  }
  await startSession(res, userId);
  res.status(201).json({ ok: true });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const email = str(req.body?.email, 120).toLowerCase(), password = String(req.body?.password || '');
  const { rows } = await query('SELECT id, password_hash FROM users WHERE lower(email) = $1', [email]);
  // same work and same message whether or not the account exists
  const ok = await verifyPassword(password, rows[0]?.password_hash || 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
  if (!rows[0] || !ok) throw new HttpError(401, 'Incorrect email or password.');
  await startSession(res, rows[0].id);
  res.json({ ok: true });
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  await endSession(req, res);
  res.json({ ok: true });
});

// POST /api/auth/password  { current, next }
router.post('/password', requireAuth, async (req, res) => {
  const cur = String(req.body?.current || ''), next = String(req.body?.next || '');
  if (next.length < 8) throw bad('New password must be at least 8 characters.');
  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await verifyPassword(cur, rows[0]?.password_hash))) throw new HttpError(401, 'Current password is incorrect.');
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [await hashPassword(next), req.user.id]);
  await query('DELETE FROM sessions WHERE user_id = $1', [req.user.id]);   // sign out everywhere
  await startSession(res, req.user.id);
  res.json({ ok: true });
});

module.exports = router;
