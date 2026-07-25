#!/usr/bin/env bash
# Hatchbox "Build Script" — runs on the app server during each deploy, with the
# working directory set to the release directory (where docker-compose.yml lives).
#
# CI has already built and pushed the image to GHCR by the time Hatchbox fires
# the deploy webhook, so this script just pulls the new image and (re)starts the
# stack. Idempotent and safe to re-run.
#
# NOTE: Hatchbox extracts releases with `git archive`, so there is NO .git here —
# never call git in this script. The deployed commit is in the REVISION file.
set -euo pipefail

# Authenticate to GHCR only if the package is private. Set GHCR_USER + GHCR_TOKEN
# (a PAT with read:packages) in the Hatchbox app env. Skip both if the package is
# public.
if [ -n "${GHCR_TOKEN:-}" ]; then
  echo "${GHCR_TOKEN}" | docker login ghcr.io -u "${GHCR_USER:?set GHCR_USER}" --password-stdin
fi

# The SQLite DB lives on a host volume mounted into the container at /data.
# Fail loudly if it is missing rather than letting Docker create an empty dir
# and silently start the app on storage that vanishes at the next redeploy.
DATA_DIR="${JMTRIMS_HOST_DATA_DIR:-/mnt/volume_lon1_futureaip/jmtrims}"
if [ ! -d "$DATA_DIR" ]; then
  echo "ERROR: data dir '$DATA_DIR' does not exist on this server." >&2
  echo "Create/mount the volume, or set JMTRIMS_HOST_DATA_DIR in the Hatchbox app env." >&2
  exit 1
fi

# Pin the image to the deployed commit (CI tags images with the 7-char short SHA),
# read from Hatchbox's REVISION file. Fall back to :latest if it's missing or the
# per-SHA image isn't in GHCR yet.
REV="$(cat REVISION 2>/dev/null || true)"
if [ -n "$REV" ]; then
  export IMAGE_TAG="${REV:0:7}"
else
  export IMAGE_TAG=latest
fi

if ! docker compose pull; then
  echo "Image :${IMAGE_TAG} not available, falling back to :latest"
  export IMAGE_TAG=latest
  docker compose pull
fi

# Hatchbox's Docker Compose guide: "Docker compose apps don't need any processes.
# Just a custom build script" that brings the stack down and back up. There is no
# Procfile and no systemd unit — this script owns the container lifecycle.
docker compose up -d --remove-orphans
docker image prune -f >/dev/null 2>&1 || true

echo "Deployed jmtrims image ghcr.io/nickmc/jmtrims:${IMAGE_TAG}"
