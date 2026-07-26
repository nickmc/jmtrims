# Deploying a Dockerised app to Hatchbox

A reusable recipe for putting **any** containerised app (Next.js, FastAPI, whatever) on a
Hatchbox-managed server, distilled from setting up JM Trims and Future AIP. `DEPLOYMENT.md`
is the JM Trims-specific version; this is the one to copy to a new project.

Hatchbox is built around apps it can detect and run itself — it recognises Rails from a
`Gemfile`, Astro from `package.json`, and configures the web server accordingly. **A Docker
Compose app matches nothing, so Hatchbox infers nothing.** Everything it would normally
work out has to be stated explicitly, and the two settings in step 5 are the ones whose
absence is least obvious: the container looks perfectly healthy while the site returns 404.

## The shape of it

```
git push main
  → GitHub Actions: docker build → push ghcr.io/<user>/<app>:latest + :<sha>
  → POST $HATCHBOX_DEPLOY_HOOK          (only after the image is in GHCR)
      → Hatchbox checks out the repo, runs your Build Script
          → docker compose pull && up -d
      → Caddy: https://<domain> → 127.0.0.1:$PORT → container
```

CI triggers the deploy rather than Hatchbox's own git-push auto-deploy, so the image is
guaranteed to exist in GHCR before Hatchbox pulls it. Leave Hatchbox auto-deploy **off**.

## Files in the repo

| File | Purpose |
|---|---|
| `Dockerfile` | Build the app image. Bind to `0.0.0.0` inside the container, not `127.0.0.1` |
| `docker-compose.yml` | `name:`, image from GHCR, `127.0.0.1:${PORT}:<container port>`, volumes |
| `deploy/hatchbox-build.sh` | Pull the image and start the stack |
| `.github/workflows/deploy.yml` | Build → push GHCR → POST the deploy hook |
| `.dockerignore` | Keep `.git`, `node_modules`, `.env*` out of the build context |

Minimum viable `docker-compose.yml`:

```yaml
name: myapp

services:
  app:
    image: ghcr.io/<user>/<app>:${IMAGE_TAG:-latest}
    restart: unless-stopped
    ports:
      - "127.0.0.1:${PORT:-3000}:3000"   # Caddy reaches it on loopback only
    volumes:
      - ${MYAPP_HOST_DATA_DIR:-/var/lib/myapp}:/data
```

`PORT` comes from Hatchbox (written to `/home/deploy/<app>/.hatchbox.env`). Binding to
`127.0.0.1` keeps the container off the public internet — Caddy is the only way in.

## Setup, in order

### 1. Server prerequisites

```bash
docker --version && docker compose version
id deploy | grep -q docker && echo "deploy is in docker group" || sudo usermod -aG deploy docker
```

If you *just* added the group, see the systemd gotcha at the bottom — it bites later, not now.

### 2. Create the app

Any generic app type. Connect the repo. The type only decides which language runtimes
Hatchbox installs on the host, which is irrelevant when the app runs in a container.

### 3. Build Script

Under **Deploy / Deploy Scripts** (only appears once the app exists, not on the creation
form):

```
bash deploy/hatchbox-build.sh
```

Hatchbox extracts releases with `git archive`, so **there is no `.git` directory** on the
server — never call `git` from that script. The deployed commit is in the `REVISION` file.

### 4. Env vars, domain, auto-deploy off

Set your app's env vars, add the domain, enable SSL, and turn auto-deploy **off**.

### 5. The two settings Hatchbox cannot infer

**Skip either and the site is dead**, however healthy the container looks.

**Process** (App → Processes):

```
docker compose up
```

No `-d`. The command must stay in the foreground so systemd can supervise it. Hatchbox
creates `<app>-web_server.service` with `Restart=always`, which starts the container on boot
and restarts it if it dies. Without a Process the container only runs if something else
started it, and a reboot leaves the site down.

**Caddyfile** (App → Settings → Caddyfile):

```
reverse_proxy 127.0.0.1:9040

%{default}
```

`%{default}` **on its own is not enough.** For an app with no detected framework it expands
*without* a `reverse_proxy`, leaving a `file_server` pointed at `current/public` — so every
request 404s. The literal directive is what actually puts a proxy in the generated config.

Two traps in that snippet:

- **Hardcode the port.** Caddy's `{$PORT}` reads *Caddy's own process environment*, where
  `PORT` is not set. It renders empty, Caddy falls back to `:80`, and you get a 308 redirect
  loop. Your app's real port is in `/home/deploy/<app>/.hatchbox.env`; Hatchbox assigns one
  per app and keeps it stable.
- **`reverse_proxy` must come before `file_server`.** Reversed, the file server answers
  first and 404s everything.

The Caddyfile only takes effect on the next deploy, when Hatchbox regenerates the config.

### 6. GitHub

Add the repo secret `HATCHBOX_DEPLOY_HOOK` (the deploy webhook URL). Set it via stdin so it
stays out of shell history:

```bash
gh secret set HATCHBOX_DEPLOY_HOOK --repo <user>/<repo>
```

After the first successful build, make the GHCR package public (simplest), or set
`GHCR_USER` / `GHCR_TOKEN` (a PAT with `read:packages`) in the Hatchbox app env.

## Verifying

```bash
# 1. does the container answer directly, bypassing Caddy?
curl -s http://127.0.0.1:<port>/healthz

# 2. does Caddy have a proxy for it?
curl -s http://127.0.0.1:2019/config/apps/http/servers | grep -A3 dial

# 3. does it work publicly?
curl -sS -o /dev/null -w "%{http_code}\n" https://<domain>/
```

If 1 works and 3 does not, the problem is Caddy's config, not your app.

## Troubleshooting

| Symptom | Cause |
|---|---|
| 404 on every path, container healthy | Caddyfile missing the literal `reverse_proxy` line |
| 308 redirect loop | `reverse_proxy` pointing at the wrong port — `{$PORT}` rendered empty → `:80`. Hardcode it |
| Container gone after reboot | No Process defined, or its unit failed |
| Unit fails: `permission denied ... docker.sock` | systemd user manager predates the `docker` group — see below |
| Site 404s with no related change | Another app's deploy regenerated Caddy config and exposed a missing `reverse_proxy` |
| Build script: `git: not found` / no `.git` | Releases are extracted with `git archive`; use the `REVISION` file |

### One Caddy config for the whole server

Hatchbox renders **one** Caddy config covering every app on the box, so deploying *any* app
re-renders the routes for *all* of them. An app whose Caddyfile lacks the `reverse_proxy`
line can appear to work for weeks on a stale in-memory config, then 404 the moment an
unrelated app deploys. If a long-running site suddenly 404s, check whether something else
deployed recently.

### The systemd user manager and the `docker` group

Processes run under `systemd --user`, which inherits its supplementary groups when the
**user manager starts** — not when a unit runs. Add `deploy` to the `docker` group after
that manager is already running and every unit it spawns still lacks the group:

```
permission denied while trying to connect to the docker API at unix:///var/run/docker.sock
```

`id deploy` shows the group and `docker` works fine over SSH, so it looks like a puzzle.
Restart the manager (`systemctl restart user@1000`, which bounces every app process on the
box) or reboot, then confirm the docker GID is present:

```bash
grep ^Groups: /proc/$(pgrep -u deploy -f 'systemd --user' | head -1)/status
getent group docker    # compare the GID
```

## Persistent data

Anything the container must keep goes on a host directory bind-mounted into it — a DO block
volume for large or independently-snapshottable data, or a plain directory like
`/var/lib/<app>` for a few MB. Both survive redeploys and reboots; only the volume survives
destroying the droplet.

Make the build script **fail** when the directory is missing, rather than letting Docker
create an empty one whose contents vanish on the next redeploy:

```bash
DATA_DIR="${MYAPP_HOST_DATA_DIR:-/var/lib/myapp}"
[ -d "$DATA_DIR" ] || { echo "ERROR: $DATA_DIR does not exist" >&2; exit 1; }
```

If the container runs as a non-root user, the host directory must be owned by that UID —
bind mounts preserve host ownership, so a mismatch shows up as permission errors on first
write:

```bash
mkdir -p "$DATA_DIR" && chown 1000:1000 "$DATA_DIR"   # 1000 = `node` in node:* images
```

**A volume on the same droplet is not a backup.** It protects against nothing that matters
most — an accidental delete, a bad migration, losing the server. Set up an off-server copy
before real user data exists.
