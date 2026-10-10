'use strict';
const { query } = require('./db');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ms = (d) => (d ? new Date(d).getTime() : null);
const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);

async function logActivity(client, type, text, by) {
  await (client || { query }).query('INSERT INTO activity (type, text, by) VALUES ($1,$2,$3)', [type, text, by || null]);
}

const PRACTICES = ['Litigation', 'Corporate & transactional', 'In-house counsel', 'Judiciary', 'Academia / student', 'Other'];

const mapAuthority = (r) => ({
  id: r.id, title: r.title, kind: r.kind, court: r.court, year: r.year, citations: r.citations,
  addedBy: r.is_sample ? 'seed' : (r.added_by || 'former-member'), addedAt: ms(r.added_at)
});
const mapLink = (r) => ({ id: r.id, from: r.from_id, to: r.to_id, by: r.by, at: ms(r.at) });
const mapFile = (r) => ({ id: r.id, name: r.name, size: r.size, type: r.type, by: r.by, at: ms(r.at) });
const mapProfile = (r) => ({
  id: r.user_id, name: r.name, practice: r.practice, city: r.city, enrolYear: r.enrol_year,
  public: r.is_public, createdAt: ms(r.created_at)
});

module.exports = { EMAIL_RE, ms, str, HttpError, bad, logActivity, PRACTICES, mapAuthority, mapLink, mapFile, mapProfile };
