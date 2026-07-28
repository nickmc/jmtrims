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
# read from Hatchbox's REVISION file. No :latest fallback — see below.
REV="$(cat REVISION 2>/dev/null || true)"
if [ -z "$REV" ]; then
  echo "ERROR: REVISION is missing or empty; cannot determine which image to deploy." >&2
  echo "Refusing to guess (deploying :latest here is what caused the 2026-07-28 incident)." >&2
  exit 1
fi
export IMAGE_TAG="${REV:0:7}"

# CI pushes the image and only then fires the deploy webhook, so the SHA-tagged
# image is always in GHCR by now. A pull failure therefore means a real problem
# (network, auth, registry outage) — not "the image isn't ready". The old code
# fell back to :latest here, which silently deployed whatever that mutable tag
# happened to point at.
# Pull the tag directly rather than via `docker compose pull`: docker-compose.yml
# now requires JMTRIMS_IMAGE, which is derived from this pull's result below, so
# going through compose here would be circular.
if ! docker pull "ghcr.io/nickmc/jmtrims:${IMAGE_TAG}"; then
  echo "ERROR: failed to pull ghcr.io/nickmc/jmtrims:${IMAGE_TAG}." >&2
  echo "Not falling back to :latest — the running container is left untouched." >&2
  exit 1
fi

# Resolve the tag to an immutable digest and run *that*.
#
# Why: `docker compose up` re-reads docker-compose.yml, whose image is
# `ghcr.io/nickmc/jmtrims:${IMAGE_TAG:-latest}`. IMAGE_TAG was exported above,
# but it does not reach the compose invocation under Hatchbox — `docker compose
# config` on the server resolves the image to `:latest`, so every deploy pulled
# the correct SHA image and then started whatever :latest pointed at. That is
# the 2026-07-28 incident: fresh code pulled, stale code served, deploy green.
#
# Passing the digest to compose as JMTRIMS_IMAGE removes the mutable tag from
# the path entirely: docker-compose.yml has no :latest default left to fall back
# to, so a lost variable now fails the deploy instead of starting old code.
IMAGE_DIGEST="$(docker image inspect \
  --format '{{index .RepoDigests 0}}' \
  "ghcr.io/nickmc/jmtrims:${IMAGE_TAG}" 2>/dev/null || true)"
if [ -z "$IMAGE_DIGEST" ]; then
  echo "ERROR: could not resolve a digest for :${IMAGE_TAG} after pulling it." >&2
  exit 1
fi
echo "Deploying ${IMAGE_DIGEST}"

# Hatchbox's Docker Compose guide: "Docker compose apps don't need any processes.
# Just a custom build script" that brings the stack down and back up. There is no
# Procfile and no systemd unit — this script owns the container lifecycle.
#
# JMTRIMS_IMAGE overrides the image in docker-compose.yml with the exact digest
# resolved above. --force-recreate guarantees a new container even when Docker
# thinks the current one already matches: a matching-but-stale container was
# previously a silent no-op that left old code serving.
JMTRIMS_IMAGE="$IMAGE_DIGEST" docker compose up -d --remove-orphans --force-recreate

# Verify the container is actually running the digest we just deployed, rather
# than trusting compose's exit code. This is the check that would have caught
# the 2026-07-28 incident on the first bad deploy instead of days later.
RUNNING="$(docker inspect --format '{{.Image}}' jmtrims-app-1 2>/dev/null || true)"
EXPECTED="$(docker image inspect --format '{{.Id}}' "$IMAGE_DIGEST" 2>/dev/null || true)"
if [ -z "$RUNNING" ] || [ "$RUNNING" != "$EXPECTED" ]; then
  echo "ERROR: container is running image '${RUNNING:-<none>}'," >&2
  echo "       but the deploy resolved '${EXPECTED:-<none>}'." >&2
  exit 1
fi

# Prune dangling images only (`-f` without `-a`): this never touches images that
# still have a tag, so futureaip's and the Rails apps' images on this shared
# server are unaffected.
docker image prune -f >/dev/null 2>&1 || true

echo "Deployed jmtrims ${IMAGE_DIGEST} (commit ${IMAGE_TAG})"
