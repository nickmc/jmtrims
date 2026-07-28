# Deploy incident — 2026-07-28

## Symptom
Live site (jmtrims.com) kept serving stale content (old single-line "coming
soon" homepage, not the new gallery/booking/contact layout) and `/healthz`
returned a plain-text `Internal Server Error` — no matter how many fixes were
pushed to `main`, or how many times "the deploy succeeded."

## Root causes found (both fixed and merged)

1. **Build-time SQLite race** (fixed in `64fda0d`, `lib/db.ts`). `next build`
   collects page data using several parallel worker processes, each of which
   imports `lib/db.ts` — which used to open + migrate the real SQLite file
   eagerly at module-load time. Multiple workers raced to write-migrate the
   same fresh file, intermittently failing the Docker build with
   `SQLITE_BUSY`/"database is locked". Fixed by skipping the real DB
   connection entirely when `NEXT_PHASE === "phase-production-build"`.

2. **Stale GHA/BuildKit layer cache** (fixed in `bc8d392`,
   `.github/workflows/deploy.yml`). The `cache-from: type=gha` /
   `cache-to: type=gha,mode=max` config was causing the final image's runtime
   stage (`COPY --from=builder ...`) to sometimes not pick up the builder
   stage's fresh output, even though the builder stage itself visibly
   recompiled from fresh source in the CI logs. Confirmed via a temporary
   diagnostic `RUN grep` step in the Dockerfile (see commit `1cd631d`, since
   reverted) that a build with cache enabled could produce a compiled bundle
   missing our `migrations` array content (`(0 migrations)` in the
   `Database schema version 3 is newer than this build knows about`
   error — see below for why "3"). Removing the cache entirely fixed this at
   the CI/image level — **verified independently** by pulling the pushed
   image's actual layers directly from GHCR's registry API (bypassing the
   server entirely) and confirming a file inside had a fresh, matching
   timestamp.

   Why "schema version 3": an earlier deploy (`c186039`, appointment booking
   feature) genuinely ran all 3 migrations against production's *empty* SQLite
   file, stamping `user_version = 3`. Every subsequent deploy kept re-serving
   *that same stale image* (whichever one was actually stuck — see below), so
   the mismatch was: real DB already at version 3, but the (stale) running
   code's `migrations` array was empty (or the array's `.length` was smaller
   than 3, depending on which specific old build was actually being served at
   any given check).

## Root cause NOT yet fully resolved: stale Docker daemon image cache on the server

Even after confirming the GHCR-hosted image was 100% correct (verified via
direct registry API layer inspection — see below for the exact method),
`docker ps` on the server showed the running container was still using files
dated `Jul 25 14:38`, not the fresh build.

**Diagnosis:** the server's local Docker daemon had a stale cached image
under the `ghcr.io/nickmc/jmtrims:latest` tag that wasn't being refreshed by
the deploy script's `docker compose pull`. Running `docker pull
ghcr.io/nickmc/jmtrims:latest` **directly** on the server did fetch the
correct new digest (`sha256:23be0f10f1082826c326d466516894704ddf41f8c46475fceb9d13b3992afe6e`
— confirmed to match what GHCR's API independently reports for both `:latest`
and the specific commit tag). This suggests `deploy/hatchbox-build.sh`'s
per-commit-SHA `docker compose pull` step was failing for some reason (not
yet diagnosed — worth checking whether it's a transient issue or systematic),
falling back to the `:latest` tag path, which is the one that was stuck.

**Where we left off:** after manually pulling the fresh `:latest` image and
running `cd ~/jmtrims/current && docker compose up -d --remove-orphans`, the
container recreated and `docker ps` reported it **healthy**. But
`curl https://jmtrims.com/healthz` and `curl https://jmtrims.com/` both now
return a **502 Bad Gateway directly from Caddy** — meaning Caddy can't reach
the container on `127.0.0.1:9040` at all, despite Docker's own internal
healthcheck (which hits `127.0.0.1:3000/healthz` *inside* the container)
passing. This is a new/different failure mode from before (previously we got
a real response — 200 or 500 — from the app; now nothing answers on the
host-mapped port from Caddy's perspective).

## Next diagnostic steps (pick up here)

1. On the server, run both of these and compare:
   ```bash
   curl -s http://127.0.0.1:9040/healthz
   docker ps
   ```
   Check the exact port mapping shown in `docker ps` (should be
   `127.0.0.1:9040->3000/tcp`) and whether hitting that port directly (bypassing
   Caddy) works. If direct-to-port also fails despite Docker reporting
   "healthy", that's a real contradiction worth its own investigation
   (healthcheck runs *inside* the container's network namespace via
   `127.0.0.1:3000`, which is not the same code path as an external
   connection to the *host's* `9040` — a host-side port-publish/iptables
   issue could explain this gap).
2. If port 9040 is fine and Caddy is still 502ing, check whether Caddy itself
   needs a reload (`systemctl --user reload-or-restart` equivalent for
   Caddy, or whatever Hatchbox's shared Caddy management provides) — it's
   possible the very rapid stop/recreate cycle we just did left Caddy's
   upstream connection pool in a bad state.
3. Once the site is confirmed actually serving fresh content again, diagnose
   *why* `deploy/hatchbox-build.sh`'s SHA-tagged `docker compose pull`
   apparently fell back to `:latest` — this is the mechanism that let the
   stale-cache bug bite in the first place, and if it's still doing that,
   future deploys are at risk of hitting the exact same local-daemon-cache
   problem again (since `:latest` is a mutable tag, but per-commit SHA tags
   are not, and only the mutable one was affected).

## Useful commands discovered during this investigation

Get an anonymous pull token for the (public) GHCR package and inspect
manifests/layers directly, without needing `docker` installed locally or
`gh`'s `read:packages` scope (which this session's `gh auth` token doesn't
have):

```bash
TOKEN=$(curl -s "https://ghcr.io/token?service=ghcr.io&scope=repository:nickmc/jmtrims:pull" \
  | node -e "process.stdin.on('data', d => console.log(JSON.parse(d).token))")

# Manifest index (multi-arch) for a tag:
curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.oci.image.index.v1+json" \
  "https://ghcr.io/v2/nickmc/jmtrims/manifests/latest"

# Specific platform manifest (layer digest list) by digest from the above:
curl -s -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.oci.image.manifest.v1+json" \
  "https://ghcr.io/v2/nickmc/jmtrims/manifests/sha256:<digest>"

# Download a layer blob directly (gzipped tar):
curl -sL -H "Authorization: Bearer $TOKEN" \
  "https://ghcr.io/v2/nickmc/jmtrims/blobs/sha256:<layer-digest>" -o layer.tar.gz
tar tzvf layer.tar.gz | grep -i "healthz\|migrations"  # inspect contents + timestamps
```

`gh run list --limit N` / `gh run view <id> --log` / `gh run view <id>
--log-failed` (after `gh auth login`, needs `workflow`/`repo` scope, which
this session already has) is the fastest way to see actual CI build output
without opening a browser.
