# BrandLoop dashboard — the Next.js app.
#
# RESPONSIBILITY
#   Build and serve the Next.js server that the browser talks to. The browser
#   never reaches the Express API directly: lib/api.ts is server-only and every
#   call is server-to-server, because the API has no CORS middleware.
#
# WHY STANDALONE OUTPUT
#   `output: 'standalone'` in next.config.ts makes `next build` emit a
#   self-contained server containing only the modules it actually imports. The
#   alternative is shipping the entire node_modules tree and running
#   `next start`. Measured after the first build: 380 MB this way.
#
# WHY NEXT_PUBLIC_DISCORD_INSTALL_URL IS A BUILD ARG
#   Next inlines every NEXT_PUBLIC_* variable into the client bundle during
#   `next build`. Setting it only at run time leaves the "Add to Discord" button
#   with an empty href — see dashboard/.env.example, which warns about exactly
#   that. The value is public by nature (a Discord client id inside an OAuth
#   URL), so baking it into the image costs nothing.
#
# DOES NOT OWN: the API (root Dockerfile) or the database.

# ── Stage 1: dependencies ───────────────────────────────────────────────────
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci && npm cache clean --force

# ── Stage 2: build ──────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
# Everything else that survived .dockerignore: app/, components/, lib/, public/,
# the config files and the lockfile.
COPY . .

# Baked into the client bundle below, so it is an argument rather than run-time
# configuration. Empty is valid: the button renders but does nothing, which is
# what the template documents.
ARG NEXT_PUBLIC_DISCORD_INSTALL_URL=""
ENV NEXT_PUBLIC_DISCORD_INSTALL_URL=$NEXT_PUBLIC_DISCORD_INSTALL_URL
ENV NODE_ENV=production

# No API is reachable during the build, and none is needed: every page that
# reads user data goes through cookies() and is therefore rendered per request.
RUN npm run build

# ── Stage 3: runtime ────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The standalone server, then the two directories it does not trace: the build's
# static chunks and the files in public/ (including the logo the healthcheck
# below reads).
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 3000

# A static asset on purpose. Probing a page would exercise getMe and the API,
# so an API outage would mark this container unhealthy and get it restarted
# while it is working perfectly — the same mistake app.js avoids by answering
# 200 from /health with a degraded dependency.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/BrandLoop-logo.png').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The server standalone emits. API_BASE_URL and NODE_ENV come from the
# environment at run time.
CMD ["node", "server.js"]
