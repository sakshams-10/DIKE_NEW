-- DÍKĒ schema. Safe to run repeatedly.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  is_admin      boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS profiles (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  practice    text NOT NULL DEFAULT 'Other',
  city        text NOT NULL DEFAULT '',
  enrol_year  integer,
  is_public   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

CREATE TABLE IF NOT EXISTS authorities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  kind       text NOT NULL DEFAULT 'judgment' CHECK (kind IN ('judgment','statute','note')),
  court      text NOT NULL DEFAULT '',
  year       integer,
  citations  integer NOT NULL DEFAULT 0 CHECK (citations >= 0),
  added_by   uuid REFERENCES users(id) ON DELETE SET NULL,   -- NULL = sample data
  is_sample  boolean NOT NULL DEFAULT false,
  added_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS authorities_title_key ON authorities (lower(title));

CREATE TABLE IF NOT EXISTS links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_id    uuid NOT NULL REFERENCES authorities(id) ON DELETE CASCADE,
  to_id      uuid NOT NULL REFERENCES authorities(id) ON DELETE CASCADE,
  by         uuid REFERENCES users(id) ON DELETE SET NULL,
  at         timestamptz NOT NULL DEFAULT now(),
  CHECK (from_id <> to_id),
  UNIQUE (from_id, to_id)
);

CREATE TABLE IF NOT EXISTS files (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  size       integer NOT NULL,
  type       text NOT NULL,
  data       bytea NOT NULL,
  by         uuid REFERENCES users(id) ON DELETE SET NULL,
  at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity (
  id         bigserial PRIMARY KEY,
  type       text NOT NULL,
  text       text NOT NULL DEFAULT '',
  by         uuid REFERENCES users(id) ON DELETE SET NULL,
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_at_idx ON activity (at DESC);

CREATE TABLE IF NOT EXISTS drafts (
  user_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL DEFAULT '',
  body       text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  type       text NOT NULL DEFAULT 'contact',
  name       text NOT NULL DEFAULT '',
  email      text NOT NULL,
  topic      text NOT NULL DEFAULT '',
  message    text NOT NULL DEFAULT '',
  at         timestamptz NOT NULL DEFAULT now()
);
