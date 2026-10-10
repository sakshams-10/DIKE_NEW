'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./src/config');
const { pool } = require('./src/db');
const { migrate } = require('./db/migrate');
const { loadUser, csrfGuard } = require('./src/auth');
const { HttpError } = require('./src/util');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);                       // behind Render / Railway / Fly / nginx
  app.disable('x-powered-by');
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"]
      }
    }
  }));

  app.use(express.json({ limit: '300kb' }));
  const limiter = (windowMs, max, message) => rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { error: message } });

  app.get('/api/health', async (_req, res) => {
    try { await pool.query('SELECT 1'); res.json({ ok: true }); } catch (_) { res.status(503).json({ ok: false }); }
  });

  app.use('/api', csrfGuard);
  app.use('/api', loadUser);
  app.use('/api/auth', limiter(15 * 60 * 1000, 40, 'Too many attempts. Please wait a few minutes.'), require('./routes/auth'));
  app.use('/api/state', require('./routes/state'));
  app.use('/api/authorities', require('./routes/authorities'));
  app.use('/api/links', require('./routes/links'));
  app.use('/api/files', require('./routes/files'));
  app.use('/api/contact', limiter(60 * 60 * 1000, 12, 'Too many messages. Please try again later.'), require('./routes/contact'));
  app.use('/api/research', limiter(60 * 60 * 1000, 60, 'Too many questions this hour.'), require('./routes/research'));
  app.use('/api/chat', limiter(60 * 60 * 1000, 60, 'Too many questions this hour.'), require('./routes/chat'));
  app.use('/api', require('./routes/me'));
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

  app.use(express.static(path.join(__dirname, 'public'), { maxAge: config.isProd ? '1h' : 0 }));
  app.use((_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'That is too large.' });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request.' });
    console.error(err);
    res.status(500).json({ error: 'Something went wrong on our side.' });
  });
  return app;
}

async function start() {
  if (config.autoMigrate) await migrate(pool);
  const app = createApp();
  return app.listen(config.port, () => console.log(`DÍKĒ listening on http://localhost:${config.port}`));
}

if (require.main === module) start().catch((e) => { console.error('Failed to start:', e.message); process.exit(1); });
module.exports = { createApp, start };
