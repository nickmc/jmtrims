# JM Trims

Portfolio and appointment-booking website for JM Trims barber shop.

## Getting started

Requirements: Node.js 22 or later.

```bash
git clone https://github.com/nickmc/jmtrims.git
cd jmtrims
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000 to view it.

## Environment variables

Copy `.env.example` to `.env.local` and fill in real values once a Supabase project exists
(Settings -> API in the Supabase dashboard gives you the URL and anon key). Until then, the
placeholder values are enough to run the app locally — nothing reads from Supabase yet.

## Status

This is an early scaffold — no site content or booking flow yet. See
`docs/superpowers/specs/2026-07-11-jmtrims-setup-design.md` for what's planned.

## Deployment

The domain is already purchased (Namecheap); hosting isn't finalized. To get a live preview
URL now via Vercel:

1. Go to https://vercel.com and sign in/sign up with the GitHub account that owns this repo.
2. Click "Add New" -> "Project".
3. Select the `jmtrims` repository (grant Vercel access to it if prompted) and click "Import".
4. Leave the default Next.js build settings and click "Deploy".
5. Every push to `main` now redeploys automatically; Vercel shows the live URL once the first
   deploy finishes.
