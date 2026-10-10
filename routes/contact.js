'use strict';
const express = require('express');
const { query } = require('../src/db');
const { EMAIL_RE, str, bad } = require('../src/util');

const router = express.Router();
const TOPICS = ['Early access', 'Practice plan', 'Firm plan', 'Partnership', 'Support', 'Something else'];

// Open to visitors (rate-limited in server.js). Stored for the admin's inbox.
router.post('/', async (req, res) => {
  const b = req.body || {};
  const email = str(b.email, 120).toLowerCase();
  const name = str(b.name, 80), message = str(b.message, 2000);
  const type = b.type === 'early-access' ? 'early-access' : 'contact';
  if (!EMAIL_RE.test(email)) throw bad('Please enter a valid email address.');
  if (type === 'contact') {
    if (name.length < 2) throw bad('Please enter your name.');
    if (message.length < 5) throw bad('Please write a short message.');
  }
  await query('INSERT INTO messages (user_id, type, name, email, topic, message) VALUES ($1,$2,$3,$4,$5,$6)',
    [req.user ? req.user.id : null, type, name, email, TOPICS.includes(b.topic) ? b.topic : 'Something else', message]);
  res.status(201).json({ ok: true });
});

module.exports = router;
