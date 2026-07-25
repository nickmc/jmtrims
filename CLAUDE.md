@AGENTS.md

# JM Trims — Project Overview

Portfolio and appointment-booking website for a barber shop ("JM Trims"), built by Nick's son.

## Status

This repo currently contains only the initial scaffold. Site content, pages, and the booking
flow are not designed yet — see `docs/superpowers/specs/2026-07-11-jmtrims-setup-design.md`
for what's been decided so far. Before building new pages or features, go through a fresh
brainstorming pass (see the `superpowers:brainstorming` skill) rather than guessing at scope.

## Tech Stack

- Next.js (App Router, TypeScript), built with `output: "standalone"` for Docker
- Tailwind CSS for styling
- SQLite via Node's built-in `node:sqlite` (requires Node 24+) — connection in `lib/db.ts`,
  migrations in `lib/migrations.ts`. No schema yet.
- Deployed as a Docker image to a Hatchbox-managed server — see `DEPLOYMENT.md`.

Two required Hatchbox settings live in the dashboard, not this repo: a **Process**
(`docker compose up`) so the container starts, and a **Caddyfile** with a literal
`reverse_proxy 127.0.0.1:9040` above `%{default}` so traffic reaches it. Hatchbox does not
infer either for a Docker Compose app — without them the site 404s no matter how healthy the
container is. `DEPLOYMENT.md` has the details and a troubleshooting table.

## Development Commands

- `npm run dev` — start the local dev server (http://localhost:3000)
- `npm run build` — production build (also type-checks the whole project)
- `npm run lint` — run ESLint

## Data

The database is created automatically at `./_data/jmtrims.sqlite3` in local development.
Schema changes are **append-only** entries in `lib/migrations.ts`, applied on startup and
tracked with SQLite's `user_version` — never edit or reorder a migration that has already
been deployed, as servers past that version will silently skip it. Write a new one instead.

SQLite is single-writer and file-backed, so the app runs as one container on one server.

## Conventions

- Prefer Server Components; only add `"use client"` where interactivity is required.
- Keep components small and focused — one clear responsibility per file.
- Environment variables go in `.env.local` (never committed) — see `.env.example` for the
  required keys.
