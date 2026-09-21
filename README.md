# BrandLoop

An assistant that plans, writes and illustrates posts for X and LinkedIn, sends
each draft to you on Discord for approval, and hands back a pre-filled composer
link so publishing is one click.

**The decision that shapes everything:** BrandLoop does not publish on your
behalf. It assists. Every post is approved by a human in Discord before anything
goes out — which is why no X or LinkedIn credential is stored anywhere in this
repository, and why browser automation is refused on principle rather than
deferred.

## What it does

A user signs up, states a niche and their own opinions, and gets a content plan:
7 or 30 days, 2–4 posts a week, with one news post per week sourced from Google
News RSS (real URLs only, so a citation cannot be hallucinated).

Each day the scheduler generates one post per platform. Drafts arrive as Discord
DMs with **Approve**, **Reject** and **Edit**; an approved post comes back as a
copy block plus a composer link — X pre-fills its composer from a URL parameter,
LinkedIn cannot, so its link routes through the dashboard's copy-and-open page
instead. Every paid call is metered against a quota that is consumed *before* the
request, so a failure never still bills.

## Contents

| Path | What it is |
|---|---|
| `src/` (this directory) | The Express API, the Discord bot and the scheduler, in one process |
| `dashboard/` | The Next.js web app — see [dashboard/README.md](dashboard/README.md) |

Both must run for the product to work. The API and the dashboard are separate
deployables with separate Dockerfiles.

## Requirements

| | |
|---|---|
| **Node.js 20+** | `discord.js` v14 and the OpenAI SDK both require it |
| **MongoDB** | Atlas's free M0 tier is enough |
| **A Discord application** | A bot token and an application id; commands are delivered by DM, so the bot needs no server |
| **One AI key** | Gemini or OpenAI — `AI_PROVIDER` selects which implementation loads |

`docs/PREREQUISITES.md` walks through every credential, including the two
failures that cost real time during setup (a password needing percent-encoding in
the connection string, and a Discord bot that must be installed on the *user*
rather than a server).

## Quick start

```bash
npm install
cp .env.example .env      # then fill in the five required values
npm run seed              # optional demo account: demo@brandloop.local / demo-password-123
npm start                 # API on :8080 — /health reports each dependency separately
```

`/health` tells you *which* dependency is down, rather than a single boolean:

```json
{ "status": "ok",
  "dependencies": { "database": true, "discord": true, "scheduler": true } }
```

## Scripts

| Command | What it does |
|---|---|
| `npm start` | The API, the bot and the scheduler in one process |
| `npm run dev` | The same, under nodemon |
| `npm test` | 156 tests via `node --test` |
| `npm run probe` | Validates every credential **and every model name** against the live APIs. `npm run probe -- --images` also generates one image for real (a paid call) |
| `npm run seed` | Creates the demo account and fixture data |

Model names live in `.env`, never in code — `npm run probe` is the one place that
checks them, because the catalog moves faster than the code does.

## Docker

```bash
docker compose up -d --build   # API on 8080, dashboard on 3000, images on a volume
docker compose ps              # both must report healthy
docker compose run --rm api npm run seed
docker compose down            # keeps the media volume; `down -v` deletes it
```

Both images are published to GHCR on every push to `main`, so a machine that only
needs to run the app can skip the build:

```bash
docker pull ghcr.io/alikhan84/brandloop-api:latest
docker compose pull
```

They contain no secrets — every credential is supplied at run time — so running
a published image still requires your own `.env`.

**A host must be able to keep this process alive.** The Discord gateway is a
WebSocket and the daily job is an in-process cron schedule, so a platform that
suspends idle containers breaks the bot and the schedule silently.
`docs/DEPLOYMENT.md` explains that constraint and which free hosts satisfy it.

## API

Everything under `/api/users`, `/api/plans`, `/api/posts` and `/api/dev` requires
a bearer JWT. Public routes are `/health`, `/api/auth/register`,
`/api/auth/login` and `/api/auth/options`.

| Method | Path | What it does |
|---|---|---|
| `GET` | `/health` | Liveness plus per-dependency status |
| `POST` | `/api/auth/register` | Create an account; returns a JWT |
| `POST` | `/api/auth/login` | Sign in; returns a JWT |
| `POST` | `/api/auth/discord/link-code` | Six-digit code to redeem with `/connect` in Discord |
| `GET` | `/api/auth/options` | Option lists for the signup form |
| `POST` | `/api/auth/verify-email` | Redeem the token from a verification link (public — the token is the credential) |
| `POST` | `/api/auth/resend-verification` | Send a fresh link, inside a per-account cooldown |
| `GET` | `/api/users/me` | The signed-in profile |
| `PATCH` | `/api/users/me` | Update the profile; every field is optional |
| `GET` | `/api/users/me/usage` | Quota usage, per bucket |
| `POST` | `/api/plans` | Generate a plan for a 7- or 30-day window |
| `GET` | `/api/plans` | List plans |
| `GET` | `/api/plans/:id` | One plan with its slots |
| `PATCH` | `/api/plans/:id/approve` | Approve a plan, so the scheduler may generate it |
| `PATCH` | `/api/plans/:id/slots/:dayIndex` | Edit a slot's angle or its planned/news type |
| `POST` | `/api/plans/:id/generate` | Generate one slot now, without waiting for the scheduler |
| `DELETE` | `/api/plans/:id` | Delete a plan |
| `GET` | `/api/posts` | Drafts and published posts |
| `GET` | `/api/posts/:id` | One post |
| `GET` | `/api/billing` | The plan catalog plus this account's tier and grants |
| `POST` | `/api/coupons/redeem` | Apply a coupon code to your account |
| `POST` | `/api/feedback` | Send feedback (rate limited per account) |
| `GET`/`POST` | `/api/admin/coupons` | Admin only: list and create coupon codes |
| `PATCH` | `/api/admin/coupons/:id` | Admin only: enable or disable a code |
| `GET` | `/api/admin/feedback` | Admin only: the feedback inbox |
| `PATCH` | `/api/admin/feedback/:id` | Admin only: mark a message read, archived or new |
| `PATCH` | `/api/posts/:id` | Edit a post's text (the dashboard's editor) |
| `GET` | `/media/:file` | Generated images |
| `POST` | `/api/dev/*` | Manual triggers for demos — enabled outside production only |

## Layout

```
src/
  app.js         Express wiring: middleware, static media, routes, error handlers
  index.js       Start-up order and graceful shutdown
  config/        env validation (Zod, fails fast) and the domain's constant vocabulary
  db/            MongoDB connection
  jobs/          The daily schedule and the job it runs
  middleware/    Auth guard, request validation, error mapping
  models/        User, ContentPlan, Post, Usage, GenerationLog
  routes/        The HTTP surface
  services/      The product: ai/ (plan, post, image), news/, discord/, publishing/, quotas
  utils/         Platform limits, URL building, logging, errors
tests/           Seven files, 156 tests — no database connection and no network
                 call, though a .env must exist because config/env.js validates
                 on import
```

## Documentation

| File | Role |
|---|---|
| `docs/social-branding-agent-PRD.md` | The requirements — what and why |
| `docs/IMPLEMENTATION-PLAN.md` | The build plan and the amendments that record what really happened |
| `docs/PREREQUISITES.md` | Credential setup, with the traps |
| `docs/DEPLOYMENT.md` | Docker, and which free hosts can actually run this |
| `AGENTS.md` | Orientation for a new developer or agent, including every gotcha that has already caused a bug |

## Status

Working end to end: auth, plan generation, news sourcing, post and image
generation, Discord approval, assisted publishing, quotas, the scheduler, and the
dashboard.

Deliberately not built: LinkedIn's Community Management API, video, and payments
(the plans page is UI only — nothing is charged and no plan is stored on the
user). Any of those three would replace a seam that already exists; none is
half-started.

Built by Ali Khan as an Applied AI & ML course project.
