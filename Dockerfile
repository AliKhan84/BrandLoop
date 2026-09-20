# BrandLoop API — the Express server, the Discord gateway client and the cron
# scheduler, all in one process.
#
# RESPONSIBILITY
#   Run `src/index.js` in production. Nothing else.
#
# WHY MULTI-STAGE
#   `bcrypt` is a native module: `npm ci` downloads a prebuilt binary when one
#   matches the platform and compiles from source when it does not. Building in a
#   throwaway stage means python3/make/g++ are available for that compile but
#   absent from the image that ships.
#
# WHY THE BUILD STAGE IS NOT `-slim`
#   The slim images have no compiler, so a fallback compile would need
#   `apt-get install python3 make g++`. That makes the build depend on a Debian
#   mirror being reachable, and a mirror returning 403 (a filtered network) fails
#   the build for a reason that has nothing to do with this code. The full image
#   is built on buildpack-deps and already has the toolchain, so nothing is
#   fetched from anywhere except npm.
#
# WHY THE PROCESS MUST STAY RUNNING
#   Two things in this container are long-lived and cannot be triggered by a
#   request: the Discord gateway WebSocket, and node-cron's daily 09:00 job. A
#   host that suspends an idle container breaks both — the bot drops offline and
#   the schedule never fires. This is the constraint that decides which free
#   hosts are usable; see docs/DEPLOYMENT.md.
#
# DOES NOT OWN: the dashboard (dashboard/Dockerfile), the database (Atlas), or
# any secret — every credential arrives as an environment variable at run time,
# and env.js fails startup with a readable list if one is missing.

# ── Stage 1: dependencies ───────────────────────────────────────────────────
# Full image on purpose: buildpack-deps already carries the toolchain, so this
# stage never reaches for a package mirror.
FROM node:22-bookworm AS deps
WORKDIR /app

# Manifests first, source second: editing src/ then re-building reuses this layer
# instead of reinstalling every dependency.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Stage 2: runtime ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080

# The official image already defines `node` (uid 1000). Using it means the app
# never runs as root, so a bug in the app cannot rewrite its own filesystem.
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
# probe/seed are operator tools and are expected to work inside the container —
# `docker compose run --rm api npm run seed` is how the demo account is created.
COPY --chown=node:node scripts ./scripts

# The media directory must exist before the app starts: app.js mounts it as
# static and the image generator writes into it. docker-compose mounts a volume
# here so images survive replacing the container.
RUN mkdir -p /app/media && chown -R node:node /app

USER node
EXPOSE 8080

# /health answers 200 whenever the process is serving — including while Discord
# or MongoDB is unreachable, because neither is fixed by restarting this
# container. That makes it exactly the right probe for "is the process alive".
# node's global fetch avoids adding curl or wget to the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form so node is PID 1 and receives the SIGTERM that index.js traps to
# close the HTTP server, the gateway and the database connection in order.
CMD ["node", "src/index.js"]
