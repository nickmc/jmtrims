# JM Trims

Portfolio and appointment-booking website for JM Trims barber shop.

## Getting started

Requirements: Node.js 24 or later (the app uses the built-in `node:sqlite` module).

```bash
git clone https://github.com/nickmc/jmtrims.git
cd jmtrims
npm install
npm run dev
```

Open http://localhost:3000 to view it.

## Data

State lives in a SQLite database. Locally it is created at `./_data/jmtrims.sqlite3`
(git-ignored) on first run — no setup needed. In production it lives on a host volume
mounted into the container at `/data`, so it survives redeploys.

Schema changes go in `lib/migrations.ts` as append-only entries; they run automatically on
startup and are tracked with SQLite's `user_version`. Never edit a migration that has
already been deployed — add a new one.

`.env.example` documents the optional overrides (`JMTRIMS_DATA_DIR`, `JMTRIMS_DB`); the
defaults are fine for local development.

## Status

This is an early scaffold — no site content or booking flow yet, and no schema. See
`docs/superpowers/specs/2026-07-11-jmtrims-setup-design.md` for what's planned.

## Deployment

Deployed as a Docker image to a Hatchbox-managed server. See [DEPLOYMENT.md](DEPLOYMENT.md).
