@AGENTS.md

# JM Trims — Project Overview

Portfolio and appointment-booking website for a barber shop ("JM Trims"), built by Nick's son.

## Status

This repo currently contains only the initial scaffold. Site content, pages, and the booking
flow are not designed yet — see `docs/superpowers/specs/2026-07-11-jmtrims-setup-design.md`
for what's been decided so far. Before building new pages or features, go through a fresh
brainstorming pass (see the `superpowers:brainstorming` skill) rather than guessing at scope.

## Tech Stack

- Next.js (App Router, TypeScript)
- Tailwind CSS for styling
- Supabase (Postgres) for data storage — client wiring exists in `lib/supabase.ts`,
  but no Supabase project or schema exists yet.

## Development Commands

- `npm run dev` — start the local dev server (http://localhost:3000)
- `npm run build` — production build (also type-checks the whole project)
- `npm run lint` — run ESLint

## Conventions

- Prefer Server Components; only add `"use client"` where interactivity is required.
- Keep components small and focused — one clear responsibility per file.
- Environment variables go in `.env.local` (never committed) — see `.env.example` for the
  required keys.
