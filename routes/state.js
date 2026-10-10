'use strict';
const express = require('express');
const { query } = require('../src/db');
const config = require('../src/config');
const { ms, mapAuthority, mapLink, mapFile, mapProfile } = require('../src/util');

const router = express.Router();

// GET /api/state — everything the front end renders, in one round trip.
router.get('/', async (req, res) => {
  const me = req.user;
  const open = !!me || config.publicRepository;
  const out = { open, me: null, authorities: [], links: [], files: [], activity: [], profiles: [], inbox: [] };

  if (me) {
    const p = (await query('SELECT * FROM profiles WHERE user_id = $1', [me.id])).rows[0];
    out.me = { id: me.id, email: me.email, isAdmin: me.isAdmin, profile: p ? mapProfile(p) : null };
  }
  if (open) {
    const [a, l] = await Promise.all([
      query('SELECT * FROM authorities ORDER BY added_at'),
      query('SELECT * FROM links ORDER BY at')
    ]);
    out.authorities = a.rows.map(mapAuthority);
    out.links = l.rows.map(mapLink);
  }
  // Public profiles (plus your own, even if you've hidden it from the community).
  const pr = await query('SELECT * FROM profiles WHERE is_public OR user_id = $1 ORDER BY created_at', [me ? me.id : null]);
  out.profiles = pr.rows.map(mapProfile);

  const act = await query('SELECT id, type, text, by, at FROM activity ORDER BY at DESC LIMIT 1000');
  out.activity = me
    ? act.rows.map((r) => ({ id: r.id, type: r.type, text: r.text, by: r.by, at: ms(r.at) }))
    : act.rows.map((r) => ({ id: r.id, type: r.type, text: '', by: 'visitor', at: ms(r.at) }));   // anonymous visitors only get counts-by-day

  if (me) out.files = (await query('SELECT id, name, size, type, by, at FROM files ORDER BY at DESC')).rows.map(mapFile);
  if (me && me.isAdmin) {
    out.inbox = (await query('SELECT id, user_id, type, name, email, topic, message, at FROM messages ORDER BY at DESC LIMIT 300'))
      .rows.map((r) => ({ id: r.id, uid: r.user_id, type: r.type, name: r.name, email: r.email, topic: r.topic, message: r.message, at: ms(r.at) }));
  }
  res.set('Cache-Control', 'no-store');
  res.json(out);
});

module.exports = router;
