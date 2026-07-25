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

The image relies on `output: "standalone"` in `next.config.ts`. That output does **not**
include `public/` or `.next/static/`, so the Dockerfile copies both in explicitly — if you
ever see the site load without CSS or images, that is the first thing to check.

## Two Hatchbox settings this app cannot work without

Hatchbox has no framework detection for a Docker Compose app (it detects Rails from a
Gemfile, Astro from `package.json`, and so on). Two things it would otherwise infer must
therefore be configured **by hand in the dashboard**, and neither lives in this repo.

### 1. A Process, so the container starts

**App → Processes → add a web process:**

```
docker compose up
```

No `-d` — the command must stay in the foreground so systemd can supervise it. Hatchbox
creates `jmtrims-web_server.service` (a `systemd --user` unit with `Restart=always`), which
starts the container on boot and restarts it if it dies. Without this the container only
runs if something else started it, and a reboot leaves the site down.

### 2. A Caddyfile with an explicit `reverse_proxy`, so traffic reaches it

**App → Settings → Caddyfile:**

```
reverse_proxy 127.0.0.1:9040

%{default}
```

**`%{default}` alone is not enough.** For an app with no detected framework it expands
*without* a `reverse_proxy`, leaving a `file_server` pointing at `current/public` — so every
request 404s no matter how healthy the container is. The literal directive above is what
actually puts a proxy in the generated config.

Notes on that snippet:

- **The port is hardcoded on purpose.** Caddy's `{$PORT}` reads *Caddy's own process
  environment*, where `PORT` is not set; it renders empty and Caddy falls back to `:80`
  (symptom: a 308 redirect loop). The app's real `PORT` lives in
  `/home/deploy/jmtrims/.hatchbox.env` and Caddy never sees it.
- **9040 is this app's assigned port.** Hatchbox assigns one per app and keeps it stable
  (`demo` 9000, `staging` 9010, `training` 9020, `futureaip` 9030, `jmtrims` 9040). If the
  app is ever rebuilt or moved and the port changes, this value must be updated by hand or
  the site will 404/502.
- **Order matters.** `reverse_proxy` must be evaluated before `file_server`; reversed, the
  file server answers first and 404s everything.

Changing the Caddyfile only takes effect on the next deploy, when Hatchbox regenerates
Caddy's config.

### Deploys regenerate config for *every* app on the server

Hatchbox writes one Caddy config for the whole box, so deploying any app re-renders the
routes for all of them. An app whose Caddyfile is missing the `reverse_proxy` line will go
down the moment *someone else's* deploy triggers a regeneration — it can appear to work for
weeks on a stale in-memory config and then 404 with no related change.

## The server

Deployed to a DigitalOcean droplet in London (`142.93.34.139`, hostname `staging-cluster`),
which also runs futureaip and three Rails apps (staging / demo / training) behind Hatchbox's
Caddy.

| | |
|---|---|
| Docker / Compose | 29.6.1 / v5.3.0 |
| Loopback ports | 9000 demo, 9010 staging, 9020 training, 9030 futureaip, **9040 jmtrims** |
| Memory | 1.9 GB total; the Next.js container uses ~110 MB, futureaip ~47 MB |
| Data volume | 10 GB block volume at `/mnt/volume_lon1_futureaip`, shared with futureaip |

### Gotcha: the `docker` group and the systemd user manager

The Process runs under `systemd --user`, which inherits its supplementary groups when the
user manager **starts** — not when a unit runs. If `deploy` is added to the `docker` group
after that manager is already running, every unit it spawns still lacks the group and fails
with:

```
permission denied while trying to connect to the docker API at unix:///var/run/docker.sock
```

Confusingly `id deploy` shows the group, and `docker` works fine over SSH — only the systemd
units are affected. Fix by restarting the user manager (`systemctl restart user@1000`) or
rebooting, then confirm the `docker` GID appears in:

```bash
grep ^Groups: /proc/$(pgrep -u deploy -f 'systemd --user' | head -1)/status
```

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

There is no "Docker Compose" app type — this runs as an ordinary app whose **Build Script**
does the Docker work. Steps 5 and 6 are the two settings above; **skip either and the site
returns 404 or never starts**, however healthy the container is.

1. Create the app and connect this repo (any generic/Node app type is fine).
2. **Build Script** — under the app's Deploy / Deploy Scripts section *after* the app
   exists, not on the creation form: `bash deploy/hatchbox-build.sh`.
3. Set the env vars above; turn **off** auto-deploy (CI triggers the deploy instead).
4. Add the domain + enable SSL (Caddy / Let's Encrypt), and point DNS at the server IP.
5. **Add a Process:** `docker compose up` (no `-d`).
6. **Set the Caddyfile:** `reverse_proxy 127.0.0.1:9040` above `%{default}`.
7. In GitHub, add the `HATCHBOX_DEPLOY_HOOK` secret.
8. If the GHCR image is private, either make the package public or set
   `GHCR_USER`/`GHCR_TOKEN`.

Hatchbox writes the assigned `PORT` (along with the env vars above) into
`/home/deploy/jmtrims/.hatchbox.env`, which is where Compose picks it up.

## Troubleshooting

| Symptom | Cause |
|---|---|
| **404 on every path**, container healthy | Caddyfile missing the literal `reverse_proxy` line — `%{default}` alone does not add one |
| **308 redirect loop** | `reverse_proxy` present but pointing at the wrong port — `{$PORT}` renders empty (Caddy's env, not the app's) and falls back to `:80`. Hardcode `9040` |
| **Container not running after reboot** | No Process defined, or its systemd unit failed |
| **Unit fails: `permission denied ... docker.sock`** | The systemd user manager predates `deploy` joining the `docker` group — restart it (see above) |
| **Site 404s with no related change** | Another app's deploy regenerated Caddy config and exposed a missing `reverse_proxy` line |
| **Deploy fails: data dir missing** | The host directory does not exist; the build script refuses rather than let Docker create disposable storage |

Useful checks (read-only):

```bash
# what Caddy is actually serving for this app
curl -s http://127.0.0.1:2019/config/apps/http/servers | python3 -m json.tool | grep -A3 dial

# does the app answer directly, bypassing Caddy?
curl -s http://127.0.0.1:9040/healthz
```

If the second works and the site still 404s, the problem is Caddy's config, not the app.

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
