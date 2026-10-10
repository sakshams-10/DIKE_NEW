'use strict';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/dike_test';
process.env.AUTO_MIGRATE = 'true';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../server');
const { pool } = require('../src/db');
const { migrate } = require('../db/migrate');

let server, base;
const jar = {};   // tiny cookie jar per "browser"
function client(name) {
  jar[name] = '';
  return async (method, url, body, extra = {}) => {
    const headers = { 'x-requested-with': 'dike', ...(extra.headers || {}) };
    let payload = body;
    if (body && !Buffer.isBuffer(body)) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    if (jar[name]) headers.cookie = jar[name];
    const r = await fetch(base + url, { method, headers, body: payload });
    const sc = r.headers.get('set-cookie');
    if (sc) jar[name] = sc.split(';')[0].endsWith('=') || /Expires=Thu, 01 Jan 1970/.test(sc) ? '' : sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, body: ct.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), headers: r.headers };
  };
}
const ana = { name: 'Ananya Rao', email: 'ana@example.com', password: 'correct horse', practice: 'Litigation', city: 'Bengaluru', enrolYear: 2014, consent: true };
const raj = { name: 'Raj Mehta', email: 'raj@example.com', password: 'battery staple', consent: true, public: false };

test.before(async () => {
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(pool);
  server = createApp().listen(0);
  base = 'http://localhost:' + server.address().port;
});
test.after(async () => { server.close(); await pool.end(); });

const A = client('ana'), R = client('raj'), V = client('visitor');
let kes, art21;

test('health + csrf guard', async () => {
  assert.equal((await V('GET', '/api/health')).status, 200);
  const r = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});

test('register validates, creates admin, logs in, rejects duplicates', async () => {
  assert.equal((await V('POST', '/api/auth/register', { ...ana, password: 'short' })).status, 400);
  assert.equal((await V('POST', '/api/auth/register', { ...ana, consent: false })).status, 400);
  assert.equal((await V('POST', '/api/auth/register', { ...ana, email: 'nope' })).status, 400);
  assert.equal((await A('POST', '/api/auth/register', ana)).status, 201);
  assert.equal((await V('POST', '/api/auth/register', { ...ana, email: 'ANA@example.com' })).status, 409);
  const s = (await A('GET', '/api/state')).body;
  assert.equal(s.me.email, 'ana@example.com');
  assert.equal(s.me.isAdmin, true, 'first account becomes admin');
  assert.equal(s.me.profile.name, 'Ananya Rao');
  assert.equal((await R('POST', '/api/auth/register', raj)).status, 201);
  assert.equal((await R('GET', '/api/state')).body.me.isAdmin, false);
});

test('login / logout / wrong password', async () => {
  const L = client('login');
  assert.equal((await L('POST', '/api/auth/login', { email: ana.email, password: 'wrong' })).status, 401);
  assert.equal((await L('POST', '/api/auth/login', { email: 'ghost@example.com', password: 'whatever1' })).status, 401);
  assert.equal((await L('POST', '/api/auth/login', { email: ana.email, password: ana.password })).status, 200);
  assert.equal((await L('GET', '/api/state')).body.me.email, ana.email);
  await L('POST', '/api/auth/logout');
  assert.equal((await L('GET', '/api/state')).body.me, null);
});

test('authorities: add, duplicate, cite, permissions, delete', async () => {
  assert.equal((await V('POST', '/api/authorities', { title: 'Nope nope' })).status, 401);
  assert.equal((await A('POST', '/api/authorities', { title: 'x' })).status, 400);
  const k = await A('POST', '/api/authorities', { title: 'Kesavananda Bharati v. State of Kerala', kind: 'judgment', court: 'Supreme Court of India', year: 1973 });
  assert.equal(k.status, 201); kes = k.body.authority;
  art21 = (await A('POST', '/api/authorities', { title: 'Article 21', kind: 'statute', year: 1950 })).body.authority;
  assert.equal((await R('POST', '/api/authorities', { title: 'kesavananda bharati v. state of kerala' })).status, 409);
  const c = await R('POST', `/api/authorities/${kes.id}/cite`, {});
  assert.equal(c.body.authority.citations, 1);
  assert.equal((await R('DELETE', `/api/authorities/${kes.id}`)).status, 403);
  assert.equal((await A('POST', '/api/authorities/not-a-uuid/cite', {})).status, 404);
});

test('links: create, duplicates, self-link, delete cascade with authority', async () => {
  assert.equal((await A('POST', '/api/links', { from: kes.id, to: kes.id })).status, 400);
  const l = await A('POST', '/api/links', { from: art21.id, to: kes.id });
  assert.equal(l.status, 201);
  assert.equal((await A('POST', '/api/links', { from: art21.id, to: kes.id })).status, 409);
  const tmp = (await A('POST', '/api/authorities', { title: 'Temporary note', kind: 'note' })).body.authority;
  await A('POST', '/api/links', { from: tmp.id, to: kes.id });
  assert.equal((await A('DELETE', `/api/authorities/${tmp.id}`)).status, 200);
  const s = (await A('GET', '/api/state')).body;
  assert.equal(s.links.length, 1);
  assert.equal(s.authorities.length, 2);
  assert.equal((await A('DELETE', `/api/links/${l.body.link.id}`)).status, 200);
});

test('files: upload, download, type check, permissions', async () => {
  const bytes = Buffer.from('hello legal world');
  const up = await A('POST', '/api/files', bytes, { headers: { 'x-filename': encodeURIComponent('notes.txt') } });
  assert.equal(up.status, 201);
  const id = up.body.file.id;
  const dl = await R('GET', `/api/files/${id}`);
  assert.equal(dl.status, 200); assert.equal(dl.body.toString(), 'hello legal world');
  assert.match(dl.headers.get('content-security-policy'), /sandbox/);
  assert.equal((await V('GET', `/api/files/${id}`)).status, 401);
  assert.equal((await A('POST', '/api/files', bytes, { headers: { 'x-filename': 'evil.exe' } })).status, 400);
  assert.equal((await R('DELETE', `/api/files/${id}`)).status, 403);
  assert.equal((await A('DELETE', `/api/files/${id}`)).status, 200);
});

test('draft is private and persists', async () => {
  assert.equal((await A('PUT', '/api/draft', { title: 'Writ', body: 'Grounds [Article 21]' })).status, 200);
  assert.equal((await A('GET', '/api/draft')).body.body, 'Grounds [Article 21]');
  assert.equal((await R('GET', '/api/draft')).body.body, '');
  assert.equal((await V('GET', '/api/draft')).status, 401);
});

test('contact: visitor can send, only admin can read', async () => {
  assert.equal((await V('POST', '/api/contact', { name: 'X', email: 'x@y.com', message: 'hello there' })).status, 400);
  assert.equal((await V('POST', '/api/contact', { name: 'Visitor', email: 'v@y.com', topic: 'Support', message: 'hello there' })).status, 201);
  assert.equal((await V('POST', '/api/contact', { type: 'early-access', email: 'e@y.com' })).status, 201);
  assert.equal((await A('GET', '/api/state')).body.inbox.length, 2);
  assert.equal((await R('GET', '/api/state')).body.inbox.length, 0);
  assert.equal((await V('GET', '/api/state')).body.inbox.length, 0);
});

test('privacy: visitors see no activity text, hidden profiles stay hidden', async () => {
  const v = (await V('GET', '/api/state')).body;
  assert.ok(v.activity.length > 0);
  assert.ok(v.activity.every((a) => a.text === '' && a.by === 'visitor'));
  assert.equal(v.files.length, 0);
  assert.deepEqual(v.profiles.map((p) => p.name), ['Ananya Rao']);          // Raj is not public
  assert.deepEqual((await R('GET', '/api/state')).body.profiles.map((p) => p.name).sort(), ['Ananya Rao', 'Raj Mehta']);
});

test('profile update, password change, research/chat fallback, account deletion', async () => {
  const p = await R('PATCH', '/api/profile', { name: 'Raj M.', practice: 'Judiciary', city: 'Pune', enrolYear: 2001, public: true });
  assert.equal(p.body.profile.name, 'Raj M.');
  assert.equal((await R('POST', '/api/auth/password', { current: 'bad', next: 'newpassword1' })).status, 401);
  assert.equal((await R('POST', '/api/auth/password', { current: raj.password, next: 'newpassword1' })).status, 200);
  const rs = await A('POST', '/api/research', { question: 'What does Kesavananda say?' });
  assert.equal(rs.status, 200); assert.equal(rs.body.ai, false); assert.match(rs.body.text, /Kesavananda/);
  assert.equal((await V('POST', '/api/research', { question: 'anything here' })).status, 401);
  const ch = await V('POST', '/api/chat', { messages: [{ role: 'user', content: 'what is a breach of contract?' }] });
  assert.match(ch.body.text, /contract/i);
  assert.equal((await R('DELETE', '/api/account')).status, 200);
  assert.equal((await R('GET', '/api/state')).body.me, null);
  const L = client('again');
  assert.equal((await L('POST', '/api/auth/login', { email: raj.email, password: 'newpassword1' })).status, 401);
});

test('static front end is served', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(await r.text(), /DÍKĒ/);
  assert.equal((await fetch(base + '/js/app.js')).status, 200);
  assert.equal((await fetch(base + '/assets/logo.png')).status, 200);
  const csp = (await fetch(base + '/')).headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'(;|$)/);
});
