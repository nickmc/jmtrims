# JMTrims Setup — Design Spec

## Purpose

Set up the initial project scaffold for a portfolio + appointment-booking website
for a barber shop ("JM Trims"), owned and built by Nick's son. This spec covers
**setup only** — no site content or pages are designed yet. Content/pages will go
through their own brainstorming pass later.

## Context

- Domain already purchased on Namecheap (DNS/hosting not configured yet).
- Nick will manage the GitHub repo (create, push, administer); his son will clone
  it locally to build on.
- Deployment target is undecided long-term (Vercel vs. the family's existing
  Hatchbox/DigitalOcean setup); Vercel is being connected now for a live preview
  URL, without ruling out switching later.

## Scope of this phase

In scope:
- A working, empty-but-runnable Next.js app, buildable and runnable locally.
- Supabase client plumbing (no schema/tables yet — no Supabase project exists yet).
- Repo docs (`CLAUDE.md`, `README.md`) so a fresh clone is self-explanatory.
- GitHub repo created and pushed.
- Step-by-step instructions (for Nick to hand to his son, and for connecting Vercel)
  — executed by hand where they require account creation or OAuth consent.

Out of scope (deferred to later specs):
- Site content/pages (portfolio gallery, services, booking UI, etc.).
- Supabase project creation and schema design.
- DNS configuration for the Namecheap domain.
- Final hosting decision (Vercel vs. Hatchbox/DO).

## Design

### 1. Repo
- Local path: `/Users/nick/code/jmtrims` (git already initialized).
- GitHub: private repo `nickmc/jmtrims`, created via `gh repo create`, pushed
  after the initial commit.

### 2. App scaffold
- Generated via `create-next-app` with: TypeScript, App Router, Tailwind CSS,
  ESLint. Tailwind is chosen so the site can be themed later without hand-rolling
  CSS from scratch.
- Standard Next.js/Node `.gitignore`.

### 3. Supabase plumbing (no live project yet)
- Add `@supabase/supabase-js` as a dependency.
- `lib/supabase.ts`: a small client factory reading
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` from environment
  variables. Not imported/used anywhere yet since there's no schema — it exists
  so the wiring pattern is established for when content work starts.
- `.env.example` documenting the two variables above, with placeholder values
  and a comment that real values come from a Supabase project (to be created
  when Nick is ready).

### 4. Docs
- `CLAUDE.md` (new file, specific to this repo): describes the project (barber
  shop portfolio + booking site), the stack (Next.js/TypeScript/Tailwind/Supabase),
  standard dev commands (`npm run dev`, `npm run build`, `npm run lint`), and an
  explicit note that site content/pages are still undecided — pointing whoever
  picks this up back to a fresh brainstorming pass before adding features.
- `README.md`: setup steps for a fresh clone — Node version required,
  `git clone`, `npm install`, copy `.env.example` to `.env.local`, `npm run dev`.
  Also notes the domain is already bought (Namecheap) and hosting is not yet
  configured.

### 5. Vercel (live preview)
- Nick connects the GitHub repo to Vercel himself through the Vercel dashboard
  (account creation and the GitHub OAuth grant are steps only the account owner
  can perform). Once connected, every push to `main` deploys automatically and
  gets a live URL — no further action needed after the one-time connection.
- I'll provide the exact click-through steps at implementation time; I won't
  attempt to create the account or approve the OAuth consent myself.

## Testing / verification

- `npm run build` succeeds locally after scaffold generation.
- `npm run dev` serves the default page at `localhost:3000`.
- Repo is pushed and visible (private) at `github.com/nickmc/jmtrims`.
