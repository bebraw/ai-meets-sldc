# AI meets SDLC – seminar website

This repository contains the website for the AI meets SDLC seminar held 13th of October at Marsio Saastamoinen Foundation Stage, Espoo, Finland.

## Interest list

The interest form stores submissions in Cloudflare D1. Email, name, and organization are encrypted before insert, and a keyed email hash is stored for deduplication. Set these before deploying:

For local testing, copy the example dotenv file and set a development-only encryption key:

```bash
cp .env.example .env
npm run dev:env
npm run db:migrate:local
npm run worker:dev
```

Turnstile is optional locally. If `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are empty, the widget is hidden and verification is skipped.

For production, create the Cloudflare resources and secrets:

```bash
wrangler d1 create ai-meets-sldc-interests
wrangler r2 bucket create ai-meets-sldc-interest-backups
wrangler secret put EMAIL_ENCRYPTION_KEY
wrangler secret put TURNSTILE_SECRET_KEY
```

Then replace the D1 `database_id` and `TURNSTILE_SITE_KEY` in `wrangler.jsonc`, and apply the migration:

```bash
wrangler d1 migrations apply ai-meets-sldc-interests --remote
```

Daily encrypted JSON backups are written to R2 under `interests/YYYY-MM-DD.json`. To decrypt a downloaded backup into CSV:

```bash
EMAIL_ENCRYPTION_KEY=... npm run interests:decrypt -- backup.json
```
