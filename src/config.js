'use strict';
require('dotenv').config();
const e = process.env;
const bool = (v, d) => (v == null || v === '' ? d : /^(1|true|yes|on)$/i.test(v));

module.exports = {
  port: parseInt(e.PORT, 10) || 3000,
  isProd: e.NODE_ENV === 'production',
  databaseUrl: e.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/dike',
  pgSsl: bool(e.PGSSL, false),
  adminEmail: (e.ADMIN_EMAIL || '').trim().toLowerCase(),
  publicRepository: bool(e.PUBLIC_REPOSITORY, true),
  autoMigrate: bool(e.AUTO_MIGRATE, true),
  sessionDays: 14,
  maxFileBytes: 10 * 1024 * 1024,
  anthropicKey: e.ANTHROPIC_API_KEY || '',
  anthropicModel: e.ANTHROPIC_MODEL || 'claude-sonnet-5-5'
};
