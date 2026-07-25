# Deployment

JM Trims deploys as a **single Docker image** to a **Hatchbox-managed server** via **Docker
Compose**, with **SQLite** on a mounted host volume. CI builds and pushes the image to GHCR
on every push to `main`, then triggers a Hatchbox deploy.

## Pipeline

```
git push main
  → GitHub Actions (.github/workflows/deploy.yml)
      → docker build → push ghcr.io/nickmc/jmtrims:latest + :<sha>
      → POST $HATCHBOX_DEPLOY_HOOK            (only after the image is in GHCR)
          → Hatchbox runs deploy/hatchbox-build.sh on the server
              → docker compose pull && up -d
          → Hatchbox Caddy: https://<domain> → 127.0.0.1:${PORT} → container :3000
```

Triggering Hatchbox **from CI** (rather than Hatchbox's own git-push auto-deploy) is
deliberate: it guarantees the new image exists in GHCR before Hatchbox pulls. Leave
Hatchbox auto-deploy **off**.

## Files

| File | Role |
|------|------|
| `Dockerfile` | Multi-stage: deps → `next build` → minimal standalone runtime |
| `.dockerignore` | Trims the build context |
| `docker-compose.yml` | Production stack (image, volume, port, healthcheck) |
| `deploy/hatchbox-build.sh` | Hatchbox Build Script: pull + restart, SHA-pinned |
| `.github/workflows/deploy.yml` | Build → push GHCR → trigger Hatchbox |

Per Hatchbox's Docker Compose guide, **Docker Compose apps need no processes** — no
Procfile, no systemd unit. The Build Script alone owns the container lifecycle.

The image relies on `output: "standalone"` in `next.config.ts`. That output does **not**
include `public/` or `.next/static/`, so the Dockerfile copies both in explicitly — if you
ever see the site load without CSS or images, that is the first thing to check.

## The server

Deployed to **`airport-prod-copy`** (DigitalOcean, London), which also runs futureaip and
three Rails apps (staging / demo / training) behind Hatchbox's Caddy.

| | |
|---|---|
| Docker / Compose | 29.6.1 / v5.3.0 — the `deploy` user is in the `docker` group |
| Loopback ports in use | 9000, 9010, 9020 (Rails), 9030 (futureaip) — Hatchbox assigns the next free one |
| Memory | 1.9 GB total; futureaip's container uses ~47 MB, so headroom is fine |

## Persistent data

The SQLite database lives under `JMTRIMS_DATA_DIR` (`/data` in the container). Compose
bind-mounts the host directory there, so the database survives redeploys.

- Host path default: `/mnt/volume_lon1_futureaip/jmtrims` — override with
  `JMTRIMS_HOST_DATA_DIR`.
- The DB resolves to `/data/jmtrims.sqlite3` (overridable with `JMTRIMS_DB`).
- The build script **fails the deploy** if the host data dir does not exist, rather than
  letting Docker silently create an empty directory whose contents vanish on redeploy.

The directory is a subdirectory of the 10 GB block volume that futureaip also uses (10 GB,
12% used). That volume is mounted by `/etc/fstab` via its stable
`/dev/disk/by-id/scsi-0DO_Volume_...` name with `nofail`, so it remounts on every reboot and
a detached volume will not block boot. Because the two apps share one volume, resizing or
detaching it affects both.

The directory must be owned by **UID 1000** — the container runs as the unprivileged `node`
user, and the bind mount preserves host ownership. It was created with:

```bash
mkdir -p /mnt/volume_lon1_futureaip/jmtrims
chown 1000:1000 /mnt/volume_lon1_futureaip/jmtrims
```

> **No backups are configured yet.** This volume is attached to the same Droplet, so it
> protects against neither an accidental delete nor loss of the server. Set up the off-server
> backup below **before taking real bookings**.

Migrations in `lib/migrations.ts` run automatically at startup, tracked via SQLite's
`user_version`. A failed migration rolls back and the container reports unhealthy.

Because SQLite is single-writer and file-backed, the app runs as **one container on one
server**. Do not scale it to multiple app servers without moving off SQLite first.

## Environment variables

Set in the Hatchbox app (Env Vars tab):

| Var | Value | Notes |
|-----|-------|-------|
| `JMTRIMS_HOST_DATA_DIR` | `/mnt/volume_lon1_futureaip/jmtrims` | Host path of the data directory |
| `PORT` | (assigned by Hatchbox) | Compose binds `127.0.0.1:${PORT}:3000` |
| `GHCR_USER` / `GHCR_TOKEN` | only if the GHCR package is **private** | PAT with `read:packages` |

GitHub repo secret: `HATCHBOX_DEPLOY_HOOK` — the deploy webhook URL from Hatchbox.

## One-time Hatchbox setup

Hatchbox has no "Docker Compose" app type here — futureaip runs as an ordinary app whose
**Build Script** does all the Docker work, and this app follows the same pattern. The app
type only decides which language runtimes Hatchbox installs on the server, which is
irrelevant because the app itself runs inside a container.

1. Create the app and connect this repo (any generic/Node app type is fine).
2. **Build Script** — found under the app's Deploy / Deploy Scripts section *after* the app
   exists, not on the creation form. Set it to run `deploy/hatchbox-build.sh`. If the field
   is a script box rather than a path, use `bash deploy/hatchbox-build.sh`.
3. Set the env vars above; turn **off** auto-deploy (CI triggers the deploy instead).
4. Add the domain + enable SSL (Caddy / Let's Encrypt), and point DNS at the server IP.
5. In GitHub, add the `HATCHBOX_DEPLOY_HOOK` secret.
6. If the GHCR image is private, either make the package public or set
   `GHCR_USER`/`GHCR_TOKEN`.

Hatchbox writes the assigned `PORT` (along with the env vars above) into
`/home/deploy/jmtrims/.hatchbox.env`, which is where Compose picks it up.

## Health check

`GET /healthz` returns `{"status":"ok","schemaVersion":N,"buildTime":"..."}`. It opens the
database on every call, so an unwritable volume or a failed migration surfaces as a 503 and
an unhealthy container rather than as a page that breaks later.

Hatchbox's own **health check URI** setting only appears when the cluster has a load
balancer role. This server is a single node behind Caddy with no LB, so that field is
absent and does not need setting — the container-level healthcheck in `docker-compose.yml`
is what restarts a wedged container.

## Updating / rollback

- **Update**: push to `main`; CI + Hatchbox handle the rest.
- **Rollback**: revert the commit and push (CI rebuilds), or on the server set
  `IMAGE_TAG=<previous-sha>` and run `docker compose up -d`. Note that rolling back does
  **not** undo a migration — write a new migration to reverse a schema change.

## Backups

The volume holds the only copy of the booking data. Set up a periodic copy of
`/mnt/volume_lon1_jmtrims/jmtrims.sqlite3` off the server before taking real bookings. Use
SQLite's online backup rather than `cp`, so you never capture a half-written WAL:

```bash
docker compose exec app node -e "
  const {DatabaseSync}=require('node:sqlite');
  new DatabaseSync('/data/jmtrims.sqlite3').exec(\"VACUUM INTO '/data/backup.sqlite3'\");
"
```

## Test the production image locally

```bash
docker build -t jmtrims .
docker run --rm -p 3000:3000 -v "$PWD/_data:/data" jmtrims
# → http://localhost:3000
```

Without Docker, the standalone output can be run directly:

```bash
npm run build
cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/
JMTRIMS_DATA_DIR=./_data PORT=3000 node .next/standalone/server.js
```
