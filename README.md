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
| `GET` | `/api/billing` | The plan catalog — price, term and limits — plus this account's tier and grants |
| `GET` | `/api/payments` | Where to send money, what a plan costs, and this account's claims |
| `POST` | `/api/payments` | Record a payment claim; the plan activates on submit by default |
| `POST` | `/api/coupons/redeem` | Apply a coupon code to your account |
| `POST` | `/api/feedback` | Send feedback (rate limited per account) |
| `GET`/`POST` | `/api/admin/coupons` | Admin only: list and create coupon codes |
| `PATCH` | `/api/admin/coupons/:id` | Admin only: enable or disable a code |
| `GET` | `/api/admin/payments` | Admin only: the reconciliation queue (`?status=awaiting`) |
| `PATCH` | `/api/admin/payments/:id` | Admin only: verify, reject, confirm or revoke a claim |
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
  models/        User, ContentPlan, Post, Usage, GenerationLog, Coupon, Feedback, Payment
  routes/        The HTTP surface
  services/      The product: ai/ (plan, post, image), news/, discord/, publishing/, quotas
  utils/         Platform limits, URL building, logging, errors
tests/           Fourteen files, 298 tests — no database connection and no network
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
generation, Discord approval, assisted publishing, quotas, the scheduler, the
dashboard, and local payment.

Deliberately not built: LinkedIn's Community Management API, video, and any card
processor. The last one is a decision rather than a deferral — a Pakistani gateway
means a merchant account, which is a business process — so payment is local and
manual instead, and the seam for a processor is the `Payment` row a webhook would
write. None of these is half-started.

## Getting paid

Payment is off until you give it somewhere to receive. Put your own account
details in `.env` and the billing page turns into a working checkout:

```bash
PAYMENT_BANK_NAME=Meezan Bank
PAYMENT_BANK_ACCOUNT_NAME=Your Name
PAYMENT_BANK_ACCOUNT_NUMBER=PK00ABCD0123456789012345   # or an account number
PAYMENT_JAZZCASH_NUMBER=03001234567                    # either wallet is optional
PAYMENT_EASYPAISA_NUMBER=03451234567
PAYMENT_CONTACT=you@example.com                        # where receipts go
```

What happens then, in order:

1. The customer picks a plan and lands on `/billing/pay`, which shows those
   accounts and takes the transaction reference. Prices come from
   `PRICE_CREATOR_PKR` and `PRICE_PRO_PKR` (defaults Rs 1,500 and Rs 3,000 for 30
   days).
2. **The plan activates as they submit it.** Nobody waits for you — that is the
   whole point of `PAYMENT_AUTO_VERIFY=true`. Set it to `false` if you would
   rather nothing activates until you have seen the money; the same queue then
   reads verify/reject instead of confirm/revoke.
3. You get a Discord DM for every claim, with **Confirm** and **Revoke** buttons.
   Check the reference against your own statement, then tap one — or settle it
   from `/admin/payments`, which also lists the history.
4. A revoke puts the account back exactly where it was, so a claim that turns out
   to be someone else's money does not cost the customer the plan they already
   had.

One claim per customer is open at a time, which bounds what a single account can
get without you looking, and a claim above `PAYMENT_AUTO_VERIFY_MAX_PKR` always
waits for you.

Built by Ali Khan as an Applied AI & ML course project.

## Signing in

Two ways in, and they lead to the same account when the address matches:

- **Email and password.** The address is unconfirmed until the link in the
  verification email is used, but nothing is gated behind it — an unconfirmed
  account works normally and the dashboard asks it to confirm.
- **Google.** Optional, and off until `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
  and `GOOGLE_REDIRECT_URI` are all set. With none of them the button reports
  that sign-in is not configured rather than failing silently.

The API performs the exchange with Google, so the client secret never reaches the
dashboard; it holds only the client ID, which is public because it travels in a
URL the browser visits. New accounts created this way arrive already verified and
receive the same `SIGNUP_TRIAL_DAYS` of Pro as a password signup.

Setup, once, in Google Cloud Console: create a project, configure the OAuth
consent screen as External, add your own address under **Test users** (in Testing
mode nothing else can sign in), then create an OAuth client of type **Web
application** with this authorised redirect URI:

```
http://localhost:3000/api/auth/google/callback
```

Put the resulting client ID and secret in `.env`, and the client ID in
`dashboard/.env.local` alongside `DASHBOARD_BASE_URL`.