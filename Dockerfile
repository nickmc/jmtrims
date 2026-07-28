# syntax=docker/dockerfile:1

# Node 24 (LTS): `node:sqlite` is stable here — no native module to compile, so
# no build toolchain in any stage and nothing to rebuild on a Node upgrade.

# --- Stage 1: install dependencies ---
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- Stage 2: build the Next app ---
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Stamped by the deploy workflow so /healthz can report which image is running.
ARG BUILD_TIME=""
ENV JMTRIMS_BUILD_TIME=$BUILD_TIME
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# TEMPORARY DIAGNOSTIC — remove once the "0 migrations" production mystery is
# solved. Confirms whether the migrations array actually makes it into the
# compiled output in THIS exact build environment (Alpine/Node 24/Turbopack),
# since a local macOS build of the identical source works correctly.
RUN echo "=== migration string occurrences in compiled output ===" && \
    grep -rc "create_connection_test" .next/server/ | grep -v ":0" || echo "NOT FOUND ANYWHERE" && \
    echo "=== total occurrences ===" && \
    grep -rho "create_connection_test\|create_appointments\|add_calendar_sync_to_appointments" .next/server/ | sort | uniq -c

# --- Stage 3: runtime ---
FROM node:24-alpine AS runtime
WORKDIR /app
ARG BUILD_TIME=""
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    JMTRIMS_DATA_DIR=/data \
    JMTRIMS_BUILD_TIME=$BUILD_TIME \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as the unprivileged `node` user that the base image already provides.
# /data is the mount point for the host volume holding the SQLite DB.
RUN mkdir -p /data && chown -R node:node /data

# `output: "standalone"` emits a server that bundles only the traced runtime
# deps. It does NOT include public/ or .next/static/ — copy those in explicitly.
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
