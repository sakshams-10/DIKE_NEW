'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const { query } = require('./db');
const config = require('./config');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'dike_sid';
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/* ---------- passwords (scrypt, no native deps) ---------- */
async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(plain, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}
async function verifyPassword(plain, stored) {
  try {
    const [alg, N, r, p, salt, hash] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const key = await scrypt(plain, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
    return crypto.timingSafeEqual(key, expected);
  } catch (_) { return false; }
}

/* ---------- sessions (random token in an httpOnly cookie; only its hash is stored) ---------- */
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 86400000);
  await query('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [sha(token), userId, expires]);
  res.cookie(COOKIE, token, {
    httpOnly: true, sameSite: config.isProd ? 'none' : 'lax', secure: config.isProd, expires, path: '/'
  });
}
async function endSession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) await query('DELETE FROM sessions WHERE token_hash = $1', [sha(token)]);
  res.clearCookie(COOKIE, { path: '/' });
}

/* ---------- middleware ---------- */
async function loadUser(req, _res, next) {
  req.user = null;
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const { rows } = await query(
      `SELECT u.id, u.email, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha(token)]);
    if (rows[0]) req.user = { id: rows[0].id, email: rows[0].email, isAdmin: rows[0].is_admin };
  }
  next();
}
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Admins only.' });
  next();
}
// Cookies are sent automatically by browsers, so mutating requests must carry a header a
// cross-site form cannot set. The bundled front end always sends it.
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'dike') return res.status(403).json({ error: 'Missing request header.' });
  next();
}

module.exports = { hashPassword, verifyPassword, startSession, endSession, loadUser, requireAuth, requireAdmin, csrfGuard };
