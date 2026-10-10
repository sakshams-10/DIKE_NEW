# DÍKĒ

Legal-intelligence workspace: a landing page plus a working app — authority repository, citation graph,
research over your own repository, private drafts, file storage, member profiles, community directory,
pricing and a contact inbox. Real email-and-password accounts.

**Stack:** Node 20+ · Express 5 · PostgreSQL (`pg`) · plain HTML/CSS/JS front end (no build step).

```
server.js            app + middleware (helmet CSP, rate limits, CSRF header, static files)
db/schema.sql        tables (idempotent) · db/migrate.js runs it on boot
src/                 config, db pool, auth (scrypt passwords, cookie sessions), AI helper, utils
routes/              auth · state · authorities · links · files · me (draft/profile/account) · contact · research · chat
public/              index.html · css/style.css · js/site.js (landing) · js/app.js (workspace) · assets/ (photos, logo)
scripts/seed.js      optional sample data, clearly labelled "Sample data" in the UI
test/api.test.js     API tests against a real Postgres
```

## Run it locally

```bash
cp .env.example .env            # then edit DATABASE_URL
createdb dike                   # or any Postgres you have
npm install
npm run seed                    # optional: 4 sample authorities + 3 links
npm start                       # http://localhost:3000
```

The first account you create becomes the admin (or set `ADMIN_EMAIL`). The admin sees an **Inbox** tab with
messages from the contact form and early-access requests.

## Tests

```bash
createdb dike_test
TEST_DATABASE_URL=postgres://localhost/dike_test npm test
```

The tests wipe the `public` schema of the database they point at — use a throwaway one.

## Deploy

- **Render:** push to GitHub → *New → Blueprint* → select the repo. `render.yaml` creates the web service and a Postgres.
  Set `ADMIN_EMAIL` (and optionally `ANTHROPIC_API_KEY`) in the dashboard.
- **Anything with Docker:** `docker build -t dike . && docker run -p 3000:3000 --env-file .env dike`.
- **Neon / Supabase / RDS:** use their connection string as `DATABASE_URL` and set `PGSSL=true`.

Behind a proxy/HTTPS set `NODE_ENV=production` (cookies become `Secure`).

## Environment

| Variable | Default | What it does |
|---|---|---|
| `DATABASE_URL` | local Postgres | connection string |
| `PGSSL` | `false` | `true` for hosted Postgres that requires SSL |
| `ADMIN_EMAIL` | — | that account is admin; if empty, the first signup is |
| `PUBLIC_REPOSITORY` | `true` | `false` hides the repository from signed-out visitors (landing then shows demo numbers) |
| `AUTO_MIGRATE` | `true` | apply `db/schema.sql` at startup |
| `ANTHROPIC_API_KEY` | — | enables AI in Research + chat; without it both fall back to keyword matching / scripted replies |
| `ANTHROPIC_MODEL` | `claude-sonnet-5-5` | model used when a key is set |

## API (all JSON, cookie session `dike_sid`; non-GET requests need the header `X-Requested-With: dike`)

| | |
|---|---|
| `GET /api/state` | everything the UI renders, in one call (signed-out visitors get a reduced view) |
| `POST /api/auth/register` · `login` · `logout` · `password` | accounts |
| `POST /api/authorities` · `POST /:id/cite` · `DELETE /:id` | repository |
| `POST /api/links` · `DELETE /api/links/:id` | citation links ("from" cites "to") |
| `POST /api/files` (raw body + `X-Filename`) · `GET/DELETE /api/files/:id` | files, ≤10 MB, stored in Postgres |
| `GET/PUT /api/draft` | your private draft |
| `PATCH /api/profile` · `DELETE /api/account` | profile / account |
| `POST /api/research` | answer drawn only from the repository |
| `POST /api/contact` · `POST /api/chat` | open to visitors, rate-limited |

## Security notes

Passwords are hashed with scrypt; only a hash of each session token is stored; cookies are `HttpOnly`, `SameSite=Lax`
(`Secure` in production); CSP forbids inline scripts; uploads are served with a fixed type, `nosniff` and a sandbox CSP;
signed-out visitors never receive activity text, files, or hidden profiles; auth, contact and AI routes are rate-limited.

## Known limits (honest list)

- One shared workspace: every signed-in member sees the same repository (matching the product as designed). Per-firm
  tenancy would be the next schema change.
- No email verification, password reset, or Google sign-in yet — those need an email provider / OAuth credentials.
- The UI refreshes when you act, when you open a page, and every 20 s; there is no websocket push.
- Files live in Postgres (simple and portable). For heavy use, move them to S3-compatible storage.
- Pricing is display-only; there is no billing integration.
