# BrandLoop — Implementation Plan: PRD Phase 1 + Phase 3

**Scope:** PRD §6 **Phase 1** (content plan → daily generation → Discord approval → assisted publish).
**Deferred:** PRD §6 **Phase 3** (image generation) — no usable image quota on the current key. See §7.
**Explicitly out of scope:** PRD Phase 2 (LinkedIn Community Management API) and Phase 4 (short video / Veo).

---

## 0.1 AMENDMENTS AFTER LIVE PROBING — read before §1

The plan below was written assuming an OpenAI key. Live testing of the actual credentials changed four things. **These amendments override the sections they touch.**

| # | Original plan | What testing found | Amendment |
|---|---|---|---|
| A1 | `openai` SDK, `responses.parse`, `zodTextFormat` | `.env` holds a **Gemini** key, not OpenAI. Gemini's `limit: 0` free tier, and `gemini-2.5-flash` returns **404 "no longer available to new users"** — the 3.x line is the only usable one | Provider is **Gemini** behind a thin abstraction in `services/ai/`. `openai` stays a supported target so the key swap later is a config change, not a rewrite. |
| A2 | `newsAgent` via `responses.parse` + `web_search` tool + citation cross-referencing | Gemini **Google Search grounding returns `429`** on free tier | News comes from **Google News RSS** — free, keyless, 100 items/feed, and every URL is genuinely real. The whole anti-hallucination check is deleted because hallucination is now structurally impossible. |
| A3 | Phase 3 image generation via `gpt-image-*` | **Every** Gemini image model returns `429 limit: 0` on free tier | **Phase 3 deferred.** Model fields (`needsImage`, `imagePrompt`, `imageGeneratedAt`, `imageUrl`) still ship in Step 0.5 so it drops in later without a migration. No `imageGenerator.js` is written — untestable code that cannot be validated is worse than no code. |
| A4 | `MONGODB_URI` with a database name in `.env` | URI has **no** db name (`.../mongodb.net/?appName=Cluster0`); Mongo silently used the `test` database — confirmed by probe | `db/connect.js` passes `dbName: 'brandloop'` explicitly. No `.env` edit needed. |

### 0.2 AMENDMENTS FROM THE BUILD — found by running it, not by reading

Five more issues surfaced only once real posts were generated end to end. Each was
diagnosed against the live service before being fixed. A6 and A9 were **silent**
failures — nothing errored, the output was simply wrong — which is the argument for
generating real posts early rather than trusting the code to be correct.

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| A5 | Every generation began failing with `429` mid-build | The **free tier allows 20 requests per day, per model**. Not per minute — per *day*. Testing exhausted `gemini-3.5-flash`. The SDK reports this as a plain `429`, indistinguishable from a burst limit | `gemini.js` now reads the `QuotaFailure` entry, detects `…PerDay…`, and **fails in 514ms with an actionable message** instead of retrying four times over 10s and reporting a generic error. `TEXT_MODEL` moved to `gemini-3.6-flash`, whose allowance is tracked separately |
| A6 | Every news slot reported "no usable news story" | The RSS query appended the user's `inputPoints` — **full sentences** — to the niche. Measured: that query returns **0 candidates**; the niche alone returns **25** | `buildQuery` uses the niche only. Personalisation moved to the *selection* step, where the model ranks real candidates using those same input points. Broad fetch, personalised selection |
| A7 | News path spent 2 model calls per slot before writing anything | Selection and analysis were separate requests, both needing the same context | Merged into one `NewsBriefSchema` call on `CHEAP_MODEL` — which draws on a **separate daily quota** from the writing model |
| A8 | A plan failed at 90s with `AbortError` and never retried | `statusOf` read `error.code` as an HTTP status, but on a transport error it is a DOMException constant (`20` = `ABORT_ERR`). A timeout therefore looked like an unknown 4xx and was classified non-retryable | `statusOf` maps `AbortError`/`TimeoutError` to **408** and range-checks `code` before trusting it. Timeout raised to 120s — measured latency ranges 2.5s–90s+ for identical requests, so the old limit was aborting work that would have succeeded |
| A9 | Generated X posts came out at **305 characters against a 280 limit** | `enforcePlatformLimit` measured the body only. Hashtags were appended *after* the check, so a body that fitted still produced an assembled post that did not. **X truncates silently, with no ellipsis** — the post would have looked broken with no error anywhere | The generator now builds the hashtag list *first*, works out the exact suffix length (`\n\n` + tags joined by spaces, matching `Post.fullText()`), and passes it as `reserve` so the body is trimmed to `limit − reserve`. A post-generation assertion logs an error if the assembled length still exceeds the ceiling. 4 tests added; verified live — new posts land at 273/280 |

**Consequence of A5 worth stating plainly:** a 30-day plan at 3 posts/week needs ~27 writing calls,
which **exceeds one model's 20/day allowance**. On the free tier that plan cannot complete in a
single day. Two options, both real: rotate `TEXT_MODEL` between models (each has its own allowance),
or use a paid key. This is a property of the tier, not of the code — and the code now says so
explicitly rather than failing obscurely.

### Verified credential status (live, not assumed)

| Credential | Status | Evidence |
|---|---|---|
| Discord bot token | ✅ **VALID** | Authenticates as `BrandLoop`, id `1549365986140885052`; matches `DISCORD_APP_ID`. Gateway ready in 2.8s |
| Discord gateway + slash commands | ✅ **WORKS** | `clientReady` in 2.8s; commands registered globally and per-guild |
| MongoDB | ✅ **WORKS** | Connected to `brandloop`, write + read + delete verified |
| JWT secret | ✅ present | Sign/verify round trip confirmed over HTTP |
| Gemini text + structured output | ✅ **WORKS** | Verified live in the e2e run: X post, LinkedIn post (2,141 and 2,549 chars), plan themes |
| Gemini Google News RSS | ✅ **WORKS** | 25 real candidates, real publishers (MobiHealthNews, Fierce Healthcare, Modern Healthcare) |
| Gemini Google Search grounding | ❌ **NO QUOTA** | `429 RESOURCE_EXHAUSTED` — superseded by A2 |
| Gemini image generation | ❌ **NO QUOTA** | `429 limit: 0` on all three image models — Phase 3 deferred (A3) |
| Gemini daily request allowance | ⚠️ **20/day/model** | `GenerateRequestsPerDayPerProjectPerModel-FreeTier` — see A5 |

**Model defaults:** `TEXT_MODEL=gemini-3.6-flash`, `CHEAP_MODEL=gemini-3.1-flash-lite`,
both set explicitly in `.env` with the rotation reason documented there.
Avoid `gemini-3.7-flash` (times out). `gemini-2.5-*` returns 404 for this account.

### 0.3 SCOPE ADDITION — the dashboard (Next.js)

Added after Phase 1 shipped, at the user's request: a web dashboard for sign-up, login,
content generation and Discord linking. Approval of individual posts stays in Discord.

**Architecture: Next.js as a backend-for-frontend, not a browser client.**

```
Browser ──same-origin──▶ Next.js server ──server-to-server──▶ Express API
```

`lib/api.ts` is the only thing that calls the Express API, and it runs on the server. This
was forced by a finding: **the API has no CORS middleware**, so a browser call would be
blocked before it left. Rather than add CORS and expose the API, the dashboard proxies every
call. Three things fall out: zero CORS configuration, the JWT lives in an httpOnly cookie no
script can read, and **the Express API needed no changes at all**.

One exception, flagged at the time: `GET /api/users/me/usage` was added to `userRoutes.js`.
Quota was previously reachable only from the Discord `/status` command, and with a 20/day
free-tier ceiling a dashboard that cannot show remaining quota would look broken the first
time generation failed. Read-only, reuses `quotaService.getUsageSummary`.

**Files:** `dashboard/` — its own package, `app/`, `components/`, `lib/`, `proxy.ts`.

**Known state:** build and lint clean; sign-up, login, route guarding, plan creation,
generation and the quota meter all verified running against the live API. The visual pass in
a real browser has **not** been done — `agent-browser` is not installed.

### 0.4 THREE BUGS CAUSED BY THE AMBIENT SHELL

Worth recording because they cost real time and none were code defects. This shell exports
`NODE_ENV=production` and `PORT=8080`, and three separate failures traced back to them:

| # | Symptom | Cause |
|---|---|---|
| A | `npm run dev` → `'nodemon' is not recognized` (API) | `NODE_ENV=production` makes npm omit **devDependencies**, so nodemon was never installed |
| B | `next build` → `Cannot read properties of null (reading 'useContext')` prerendering `/_global-error` | Running the build with `NODE_ENV=development` overridden. Next warns about this explicitly and it breaks prerendering |
| C | `npm run dev` (dashboard) → `EADDRINUSE :::8080` | Next reads `process.env.PORT`, which the shell exports as `8080` — the API's port. Fixed by pinning `-p 3000` in the dashboard's scripts so ambient state cannot repoint it |

**Root-cause fix for A and B:** `.npmrc` at the repo root and in `dashboard/`, both setting
`include=dev`. This counters the `--omit=dev` that npm infers from `NODE_ENV=production`, so
development dependencies install regardless of the ambient environment. A production deploy
can still opt out with `npm ci --omit=dev`, which takes precedence. Bug B was self-inflicted —
I was forcing `NODE_ENV=development` to work around A, and Next warns explicitly that this
breaks prerendering. Fixing A removed the reason to do it.

### 0.5 SWITCHED TO OPENAI — and the bug that only appeared once it ran

A working `sk-proj-…` key arrived, so the provider moved from Gemini to OpenAI.
`AI_PROVIDER=openai`, `TEXT_MODEL=gpt-5.1`, `CHEAP_MODEL=gpt-4.1-mini`, `IMAGE_MODEL=gpt-image-1`.
Gemini remains fully implemented and restorable from the commented block in `.env`.

**Phase 3 is no longer blocked.** `gpt-image-1` generated a real image (1.7MB of base64) on
the first attempt. The deferral in §7 was caused by `429 limit: 0` on every Gemini image
model; that constraint does not exist here. Phase 3 is now *not written* rather than *not
possible* — a scope decision, not a blocker.

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| A10 | Every call failed with `400 Invalid schema for response_format: 'additionalProperties' is required to be supplied and to be false` | `schemas.js` was written for **Gemini's** OpenAPI subset, which *rejects* `additionalProperties`. OpenAI's `strict: true` **requires** it, on every object at every depth. The two providers cannot share a schema verbatim | `openai.js` gains `toStrictSchema()`, a recursive adapter applied on the way out. The shared schema stays provider-neutral; each provider adapts it. Forking the schemas would have meant two near-identical copies guaranteed to drift |
| A11 | Plan generation silently returned placeholder themes ("Practical notes on this field") | A10 hit plan generation too. `generateContentPlan`'s fallback absorbed the error — correctly, by design — but the plan looked plausible, so the failure was invisible until the themes were read | No code defect; the fallback behaved as intended. Worth recording that a designed degradation can hide an upstream break, and that `usedFallback: true` was the only signal it happened |
| A12 | The probe reported `IMAGE_MODEL` as failing | The probe tested the image model through `describeModel`, which uses the **Responses API**. Image models are not served there: `400 ... not supported with the Responses API` | Added `describeImageModel` to the provider interface, which checks visibility via `models.retrieve` and reports "visible … generation not exercised" rather than claiming it works. Testing a model through the wrong endpoint produces a confident wrong answer |

**Measured on the new provider:** plan generation 5.9s with genuinely specific themes;
a two-platform slot 68.6s; X draft 265/280 chars, LinkedIn 2,574/3,000. Note `gpt-5.1` is a
reasoning model and spends output tokens on internal reasoning — a trivial JSON probe cost
131 tokens against 6 for `gpt-4.1-mini`, which is why the cheap tier uses a non-reasoning
model.

### 0.6 AMENDMENTS — PHASE 3 BUILT (was §7, deferred by A3)

A3 deferred image generation because every **Gemini** image model returned `429 limit: 0`.
§0.5 switched the provider to OpenAI, where `gpt-image-1` has quota, so Phase 3 was built
and verified live rather than left deferred. **§7 describes the specification; this section
records what actually shipped and the three deviations from it.**

| # | Spec said | What shipped | Why |
|---|---|---|---|
| P1 | `generateImageForPost(post)` calls the provider directly | The provider gained `generateImage()` on **both** implementations, and `imageGenerator` builds the prompt, writes the file and classifies failures | Keeps the provider abstraction intact — an `AI_PROVIDER=gemini` switch must not silently lose images. The Gemini branch is written but **unexercised** (that key still has zero image quota); the OpenAI branch is the verified one |
| P2 | Wire into `generateDayPost` only | Also wired into `regeneratePost` | A rejected draft is a rejection of the writing, not of the artwork. Leaving it out produced a replacement that asked for an image and had none |
| P3 | Notices of a skipped image are transient | `Post.imageSkipReason` persists it | The approval message is rebuilt from the document on every edit, so a note held only in memory vanished on the next re-render |

**Also found live, and fixed:** Discord **does not preserve a message's attachments across
an edit**. Re-rendering a message without re-sending the file left the image message with no
attachment at all — the tempting "don't re-upload what is already there" optimisation. The
payload now re-attaches the file on every render, and a regression test pins it. The
approved-state message re-attaches it too, so the image survives the Approve edit.

**Second defect the acceptance check exposed:** `GenerationLog.record` accepted
`estimatedCostUsd` from `logGeneration` and **silently dropped it** — the parameter was
never destructured — so every row stored `null` and the PRD §7 cost table summed to `$0`.
Quotas looked free. Now written through. Rows created before the fix keep their null cost;
there is no backfill, so the report is accurate from here on rather than retroactively.

**Measured on this key:** one 1024x1024 image = 115KB JPEG in 16.8s, 31 input / 1,056 output
tokens (≈$0.042 estimated). Delivery verified end to end: image attached in the Discord DM,
`/media/{postId}.jpg` served with `200 image/jpeg`, and a capped weekly bucket queues the
post text-only with the note rather than erroring. `npm run probe -- --images` now exercises
the real generation path (opt-in, because the call is paid).

**Follow-up — getting the image into LinkedIn.** The composer page copied the text and stopped
there, which left the image behind at exactly the step it is needed. LinkedIn has no URL
parameter that attaches an image (the link has no way to prefill *anything*, per `CopyAndOpen`),
and the API that could is out of scope. So the page copies the **image** to the clipboard
instead, and LinkedIn takes it on paste. Two consequences worth knowing:

- The browser cannot read the API's `/media` URL — no CORS, and a canvas drawn from it is
  tainted — so the bytes are served through a new dashboard route, `GET /api/posts/[postId]/image`,
  which loads the post with the session token first so it cannot proxy anyone else's image.
- The JPEG is re-encoded to **PNG in the canvas before the write**, because Chromium refuses
  `image/jpeg` on the clipboard outright. Verified in a real browser: the clipboard ends up
  holding `image/png`.

---

## 0. WHERE THIS PLAN LIVES

This is the version-controlled copy inside the repo. The canonical working copy lives at
`C:\Users\alikh\.commandcode\plans\brandloop-phase1-phase3.md` (openable via the `/plans` slash command).

| File | Full path | Status |
|---|---|---|
| **Canonical plan** | `C:\Users\alikh\.commandcode\plans\brandloop-phase1-phase3.md` | ✅ Exists |
| Plan copy in repo | `D:\projects\BrandLoop\docs\IMPLEMENTATION-PLAN.md` | ✅ This file |
| Prereq checklist in repo | `D:\projects\BrandLoop\docs\PREREQUISITES.md` | ✅ Exists |

> ## Status: ⛔ BLOCKED on §2 — the prerequisites gate
> Work through `docs/PREREQUISITES.md`, tick the boxes, then say the word. I verify everything with
> `npm run probe` before writing any application code. Exact sequence in **§2.6**.

---

## 1. Confirmed decisions

These were resolved with the user before planning. They override the PRD where they differ.

| # | Decision | Effect |
|---|---|---|
| 1 | **No auto-publishing in this build.** Neither X nor LinkedIn publishes via API. Approve = *assisted publish* (composer link + copyable text) for **both** platforms. | X API billing + `xPublisher.js` real calls are deferred. `publishMethod` stays `'assisted'` everywhere. The publisher interface is built so the real X/API call can be dropped in later without touching the Discord layer. |
| 2 | **No Next.js dashboard.** Phase 1 is the Express backend + Discord bot. Niche/points enter via REST + a seed script. | Drops an entire deployable. A read-only `GET /api/posts` + `GET /api/plans` gives demo-able history. |
| 3 | **Both platforms per posting slot.** Each slot yields one X draft and one LinkedIn draft (different length/voice), both queued for approval. | Matches the PRD `Post` model + the Phase 1 "done when". Discord sends one message per platform per slot. |
| 4 | **Discord = per-user DM via slash command.** `/connect <code>` links a Discord account to a BrandLoop user. Drafts arrive as DMs. | Needs the `DirectMessages` intent and a link-code flow. |
| 5 | **Real Discord + MongoDB, real OpenAI.** | `DISCORD_BOT_TOKEN`, `MONGODB_URI`, `OPENAI_API_KEY` are hard requirements. |

### PRD ambiguity resolved (flag for the report)
PRD §5 has `plan.days` as one entry per **calendar day** (7 or 30), but `User.postFrequency` is **2–4 posts per week**. These contradict: a 7-day plan at 3/week should hold 3 slots, not 7.

**Resolution:** `ContentPlan.days` = one entry per **posting slot**, not per calendar day. `dayIndex` is the 1-based slot ordinal. `totalSlots = round(postFrequency × durationDays / 7)`, spread evenly across the plan window, with news slots pinned near the end of each 7-day block (PRD §4: 1 news post/week, fixed).

---

## 2. Prerequisites — the build gate

**No application code is written until every box below is ticked.** Work from here or from `docs/PREREQUISITES.md` — same content. Nothing here is optional.

### 2.1 OpenAI
- [ ] **Regenerate the API key.** The current `.env` value is malformed — `openai_api_key=sk-VbI6…ytzcA U` has a lowercase variable name, a stray `" U"` suffix, and a legacy `sk-` format from before project keys existed. Get a fresh one at `platform.openai.com/api-keys`.
- [ ] Put it in `.env` as `OPENAI_API_KEY=sk-proj-…` — **exact uppercase name, no quotes, no trailing whitespace.**
- [ ] Confirm billing is enabled on the OpenAI account. Phase 1 makes real, paid calls.
- [ ] **Start Organization Verification** at `platform.openai.com/settings/organization/general`. Only Phase 3 needs it (GPT Image models return 403 without it), but approval isn't instant — starting it now avoids discovering it mid-Phase-3.
- [ ] Set a **hard spend cap** in the OpenAI dashboard (PRD §7) before any public or demo link goes out.

### 2.2 Discord
- [ ] Create an application at `discord.com/developers/applications` → **New Application**.
- [ ] **Bot** tab → **Add Bot** → copy the token to `.env` as `DISCORD_BOT_TOKEN=`.
- [ ] Copy the **Application ID** from *General Information* to `.env` as `DISCORD_APP_ID=`.
- [ ] **Bot** tab → *Privileged Gateway Intents* → enable **Message Content Intent**.
- [ ] **Installation** tab → enable **User Install** and **Direct Messages** so users can DM the bot. Install scopes: `bot` + `applications.commands`.
- [ ] Generate the install link from the *Installation* tab and authorise the bot onto a test server you own — a mutual server is required before you can DM the bot.
- [ ] Enable **Developer Mode** in your Discord client (Settings → Advanced) so you can copy your own user ID for testing.

### 2.3 MongoDB
- [ ] Create a free **M0 cluster** at `cloud.mongodb.com`.
- [ ] **Database Access** → add a user with read/write on the app database; copy the password.
- [ ] **Network Access** → allow-list your current IP (or `0.0.0.0/0` for dev only).
- [ ] **Connect → Drivers** → copy the SRV string to `.env` as `MONGODB_URI=mongodb+srv://…`, replacing the password and appending a database name — e.g. `…/brandloop?retryWrites=true&w=majority`.

### 2.4 Local
- [ ] Node.js **20 or newer** (`node -v`). discord.js v14 and the OpenAI SDK both require it.
- [ ] `JWT_SECRET` — any long random string in `.env`.
- [ ] Outbound HTTPS to `api.openai.com` and `discord.com` is not blocked. PRD §8 calls this out for the university server; validate locally now too.

### 2.5 Handled by the agent — no action needed
- `package.json` `"type": "modulejs"` is invalid → fixed to `"module"` in Step 0.1 (otherwise every `import` fails).
- All npm dependencies, `.gitignore`, `.env.example`, and the directory scaffold → Steps 0.1–0.5.

### 2.6 Handoff protocol — exactly how this goes

| # | Who | Action |
|---|---|---|
| 1 | **Agent** | ✅ DONE — wrote `docs/IMPLEMENTATION-PLAN.md` + `docs/PREREQUISITES.md` (Step 0.0). Stopped. |
| 2 | **You** | Work through §2.1–2.4 at your own pace, ticking boxes in `docs/PREREQUISITES.md`. |
| 3 | **You** | Say the checklist is clear. |
| 4 | **Agent** | Build Steps 0.1–0.5 (scaffold, env config, constants, DB models) + `scripts/probe.js`. **Still no app logic.** |
| 5 | **Agent** | Run `npm run probe`. |
| 6 | **Agent** | Any **FAIL** → stops and reports exactly which credential is wrong and what to fix. All **PASS** → builds Phase 1 → Phase 3 straight through. |

**Note the difference between steps 1 and 4:** Step 0.0 created documentation only. It wrote no `src/` file, changed no dependency, and touched no config — both docs are freely editable before anything else happens.

**Why the probe runs at step 5 and not step 1:** it needs `package.json` scripts and `scripts/probe.js` to exist first, which are Steps 0.1 and 0.6. Step 5 is therefore the earliest point a real programmatic check is possible.

**Standing assumption:** `.env` stays the single source of secrets and is never committed — Step 0.1 gitignores `.env`, `media/`, and `node_modules`. If a credential is still missing at step 5, it is surfaced rather than stubbed, because a stubbed Discord would hide exactly the DM-flow bugs that are the point of Phase 1.

---

## 3. Repository layout

```
BrandLoop/
├─ .env / .env.example              # .env gitignored
├─ package.json                     # type:"module", scripts: start/dev/probe/seed/test
├─ docs/
│  ├─ social-branding-agent-PRD.md  # original PRD, unchanged
│  ├─ IMPLEMENTATION-PLAN.md        # this plan
│  └─ PREREQUISITES.md              # the tickable checklist
├─ media/                           # generated images (gitignored), served statically
├─ scripts/
│  ├─ probe.js                      # Step 0.6 — credential gate
│  └─ seed.js                       # Step 0.7 — demo user + plan
└─ src/
   ├─ index.js                      # entry: env → db → express → cron → discord
   ├─ app.js                        # express wiring, static /media, /api routes, error handler
   ├─ config/
   │  ├─ env.js                     # zod-validated env, fail-fast with readable errors
   │  └─ constants.js               # platform limits, content-mix, image sizes, quotas
   ├─ db/connect.js
   ├─ models/
   │  ├─ User.js
   │  ├─ ContentPlan.js
   │  ├─ Post.js
   │  ├─ Usage.js                   # per-user quota counters
   │  └─ GenerationLog.js           # token/cost audit trail (feeds the report)
   ├─ services/
   │  ├─ ai/
   │  │  ├─ index.js                # provider selector — reads AI_PROVIDER, returns impl
   │  │  ├─ gemini.js               # ACTIVE provider: Gemini generateContent + retry
   │  │  ├─ openai.js               # STUB target for the later OpenAI swap
   │  │  ├─ schemas.js              # zod-shaped JSON Schema for structured output
   │  │  ├─ planGenerator.js        # 7/30-slot plan
   │  │  ├─ postGenerator.js        # planned + news post text
   │  │  └─ imageGenerator.js       # PHASE 3 — DEFERRED, not written (amendment A3)
   │  ├─ news/
   │  │  └─ rssNews.js              # Google News RSS fetch + parse (amendment A2)
   │  ├─ discord/
   │  │  ├─ client.js
   │  │  ├─ commands.js             # /connect, /status, /plan
   │  │  ├─ approvalQueue.js        # renders draft + buttons
   │  │  └─ interactions.js         # button/modal routing
   │  ├─ publishing/
   │  │  ├─ index.js                # publishPost() dispatcher
   │  │  ├─ xPublisher.js           # assisted: compose-intent URL
   │  │  └─ linkedinPublisher.js    # assisted: composer URL + copy block
   │  ├─ planService.js             # orchestration: create / generateDay / regenerate
   │  ├─ quotaService.js            # enforce per-user caps
   │  └─ usageLogger.js             # write GenerationLog rows
   ├─ jobs/
   │  ├─ scheduler.js               # node-cron registration
   │  └─ dailyPostJob.js
   ├─ routes/
   │  ├─ authRoutes.js  userRoutes.js  planRoutes.js  postRoutes.js  devRoutes.js
   ├─ middleware/
   │  ├─ auth.js                    # JWT verify
   │  ├─ errorHandler.js
   │  └─ validate.js                # zod body validation
   └─ utils/
      ├─ logger.js  ApiError.js  text.js  urlBuilder.js
```

**Dependencies to add:** `@google/genai` (active provider), `discord.js`, `dotenv`, `zod`, `node-cron`, `jsonwebtoken`, `fast-xml-parser` (RSS). `openai` is also installed for the deferred swap in amendment A1.

**Already installed:** `express` 5, `bcrypt`, `mongodb`, `mongoose` 9, `nodemon`. Express 5 forwards async rejections to the error middleware natively, so no `asyncHandler` wrapper is needed.

**Test runner:** Node 24's built-in `node --test`. No Jest/Vitest dependency — `buildPlanSlots` and `utils/text.js` are pure functions, which is all the plan asks the suite to cover.

---

## 4. CODING STANDARD — comments (explicit requirement)

**Every function gets a JSDoc block. No exceptions.** This applies to every file in `src/` and `scripts/`.

```js
/**
 * Builds the posting-slot sequence for a content plan.
 *
 * WHY: the PRD stores one `days[]` entry per calendar day, but postFrequency is
 * posts-per-week. This reconciles them into `totalSlots` evenly-spread posting slots.
 *
 * @param {object}  p
 * @param {7|30}    p.durationDays      - Plan window in calendar days.
 * @param {2|3|4}   p.postFrequency     - Posts per week.
 * @param {number}  [p.newsPostsPerWeek=1] - PRD §4 fixed ratio.
 * @returns {{dayIndex:number, dayOfPlan:number, theme:string|null, type:'planned'|'news', status:string}[]}
 * @sideeffect none (pure)
 */
export function buildPlanSlots({ durationDays, postFrequency, newsPostsPerWeek = 1 }) { /* … */ }
```

Rules:
- JSDoc above **every** function: one-line purpose, `@param`, `@returns`, `@throws` if it throws, `@sideeffect`.
- Inline `//` comments on non-obvious branches (retry logic, quota checks, Discord defer timing, content-mix math) explaining **why**, not restating the code.
- Every exported module gets a header comment stating its responsibility and what it does *not* own.
- Docstrings on Mongoose schemas describing each field's meaning and units.

---

## 5. PHASE 0 — Foundation

### ⛔ Step 0.0 — Write the plan + prerequisite docs into `docs/`, then STOP ✅ DONE

Wrote both files into `D:\projects\BrandLoop\docs\`:
- **`docs/PREREQUISITES.md`** — the §2 checklist formatted to tick, with the exact click-path for every credential.
- **`docs/IMPLEMENTATION-PLAN.md`** — this plan.

Created no `src/` file, changed no dependency, touched no config.

---

**Steps 0.1–0.8 run only after the §2 checklist is cleared.** All of them are mechanical scaffolding with no application logic, so that the probe at 0.6 can return a clean verdict.

**Step 0.1 — Repair scaffolding.** Rewrite `package.json`: `"type": "module"`, `"main": "src/index.js"`, scripts `start`/`dev`/`probe`/`seed`/`test`. Add `.gitignore` (`node_modules`, `.env`, `media/`). Create the `media/` directory.

**Step 0.2 — `src/config/env.js`.** Zod-validated env object. Required: `OPENAI_API_KEY`, `MONGODB_URI`, `DISCORD_BOT_TOKEN`, `JWT_SECRET`, `DISCORD_APP_ID`. Optional with defaults: `TEXT_MODEL`, `NEWS_MODEL`, `IMAGE_MODEL`, `PORT`, `DISCORD_LINK_CODE_TTL_MIN`, `CRON_DAILY_POST_SCHEDULE`, `DEV_TOOLS_ENABLED`, quota values, `X_CHAR_LIMIT`, `LINKEDIN_CHAR_LIMIT`, `PUBLIC_BASE_URL`. Read the legacy lowercase `openai_api_key` as a fallback so nothing breaks mid-migration. On failure, log a readable bulleted list of what's missing, then `process.exit(1)`.

**Step 0.3 — `.env.example`** documenting every variable with a comment and safe default.

**Step 0.4 — `src/config/constants.js`.** `PLATFORM_LIMITS` (X 280 / LinkedIn 3000), `CONTENT_MIX.NEWS_POSTS_PER_WEEK = 1`, `IMAGE_SIZES` (`x: '1536x1024'`, `linkedin: '1024x1024'`, both multiples of 16 per the API's custom-dimension rules), `QUOTAS` (`planGenerationsPerDay: 3`, `newsLookupsPerDay: 2`, `imagesPerUserPerWeek: 5` — PRD §7), `MAX_REGENERATIONS_PER_POST: 3`.

**Step 0.5 — DB + models.** `db/connect.js` (mongoose connect + retry/backoff). Models per PRD §5, with these deliberate additions:
- `User`: `usage` counters, `discordLinkCode` + `discordLinkCodeExpiresAt`, `isActive`, `timezone`.
- `ContentPlan`: `days[]` gains `dayOfPlan` (calendar offset, for the scheduler) alongside `dayIndex` (slot ordinal), plus `newsHeadline`/`newsUrl` once generated.
- `Post`: **add `needsImage`, `imagePrompt`, `imageGeneratedAt`, `regenerationCount`** now rather than migrating later for Phase 3. `platform`, `type`, `status`, `publishMethod`, `discordMessageId`, `scheduledFor`, `publishedAt` per PRD.
- `Usage` — `{ userId, key, periodStart, count }`, unique compound index on `(userId, key, periodStart)`. Used by `quotaService`.
- `GenerationLog` — `{ userId, kind, model, inputTokens, outputTokens, estimatedCostUsd, requestId, createdAt }`. Cheap, and it's exactly what PRD §7 needs for the spend-cap story and the write-up.

**Step 0.6 — `scripts/probe.js`.** The gate check. Verifies, printing a clear PASS/FAIL per line:
(a) OpenAI key via a minimal `responses.create` with a tiny zod structured output — proving key validity **and** that the Responses API + strict-schema shape works;
(b) MongoDB connection;
(c) Discord `client.login()` + `fetchApplication()`;
(d) `OPENAI_API_KEY` contains no whitespace.
It additionally reports whether each configured model name (`TEXT_MODEL`, `NEWS_MODEL`, `IMAGE_MODEL`) is accepted, so a bad model name surfaces here rather than mid-Phase-1. **Reports results and stops if anything fails — §2.6 step 6.**

**Step 0.7 — `scripts/seed.js`.** Creates a demo user, bcrypt-hashes a password, prints the user id + a Discord link code. Repeatedly useful for demos.

**Step 0.8 — `src/app.js` + `src/index.js`.** Express app with `express.json()`, `express.static('/media')`, a `GET /health`, routes, error handler. Entry point wires env → DB → HTTP → cron → Discord, with graceful shutdown on SIGINT/SIGTERM.

---

## 6. PHASE 1 — Content plan, generation, Discord approval, assisted publish

### 6.1 Auth + Discord linking (needed for the DM flow)

- `POST /api/auth/register` and `/login` → bcrypt compare, JWT issued, `middleware/auth.js` verifies it.
- `POST /api/auth/discord/link-code` (JWT) → 6-digit code, TTL from env, stored on the user.
- Discord `/connect <code>` → in `services/discord/commands.js`, look up the code, set `user.discordUserId`, confirm ephemerally, delete the code. Reject expired/used codes. (Deliberately avoids typing a password into Discord.)

### 6.2 Module: `services/ai/` — the generation core

> **Amendment A1 applies.** Provider is Gemini via `@google/genai`, not OpenAI. The three capabilities below are the *entire* provider surface — that narrow interface is what makes the OpenAI swap later a config change instead of a rewrite.

**The provider interface** — every implementation in `services/ai/` exposes exactly these:
```js
generateStructured({ systemPrompt, userPrompt, schema, model })  // → object matching `schema`
generateText({ systemPrompt, userPrompt, model })                // → string
// generateImage(...) — PHASE 3, deferred (amendment A3)
```

**`index.js`** — reads `AI_PROVIDER` from env, returns the matching implementation. Gemini is the only one wired today; `openai.js` implements the same interface for the later swap.

**`gemini.js`** — the active provider.
- `new GoogleGenAI({ apiKey })` once at module load.
- `generateStructured` → `ai.models.generateContent({ model, contents, config: { systemInstruction, responseMimeType: 'application/json', responseSchema } })`, then `JSON.parse` the first `.text` part.
- **`responseSchema` is not full JSON Schema.** Confirmed by testing: Gemini accepts the OpenAPI subset. That means **no `additionalProperties`, no `$ref`, and `.nullable()` / `.optional()` in zod do not survive the conversion.** Every schema in `schemas.js` is therefore hand-written as a plain object literal with explicit `required[]` arrays — no zod-to-JSON-Schema conversion step, because that conversion would emit keywords Gemini silently rejects.
- `withRetry()` does exponential backoff on **429 and 5xx only**. It explicitly does **not** retry `SAFETY` / `PROHIBITED_CONTENT` finish reasons — those are deterministic, and retrying burns quota for the same refusal.

**`schemas.js`** — plain JSON-Schema object literals (Gemini's OpenAPI subset):
- `ContentPlanSchema`: `{ days: [{ dayIndex, theme, type: 'planned'|'news' }] }` — nested array-of-objects, which testing confirmed works.
- `PostDraftSchema`: `{ content, hashtags: string[], imageIdea: string }`.
- Every property gets a `description` so the model knows the expected content.

**`news/` is a separate module** — see 6.2b. It is not an AI provider.

### 6.2b Module: `services/news/rssNews.js` — news sourcing

> **Amendment A2 applies.** Gemini's Google Search grounding returns `429` on this key, so news does **not** go through the model at all.

**`rssNews.js`** → `fetchNicheNews({ niche, inputPoints })`
- Builds a query from niche + the user's input points, hits
  `https://news.google.com/rss/search?q=<query>&hl=en-US&gl=US&ceid=US:en`, and parses with `fast-xml-parser`.
- Verified live: **HTTP 200, 100 items per feed**, each with `title`, `link`, `pubDate`, `source` (publisher name) and `<source url="...">` (publisher homepage).
- **Known constraint, confirmed by testing:** the `<link>` is a `news.google.com/rss/articles/…` redirect that does **not** resolve server-side (it needs client-side JS). So the function stores all three of `sourceNewsUrl` (the Google link — real and clickable in a browser), `sourceName` (e.g. "The New York Times") and `sourceHomepage` (`https://www.nytimes.com`). The Discord embed shows the publisher name so the source is legible without following the link.
- **No anti-hallucination check is needed.** Every URL comes from the feed, so the model is structurally incapable of inventing one. This is why A2 is strictly better than the original design, not just a workaround.
- Strips the ` - Publisher` suffix Google appends to titles, dedupes by normalised title, and drops anything older than `NEWS_MAX_AGE_DAYS`.
- `quotaService.consume(userId, 'newsLookups')` still applies — it protects the RSS fetch and the summarisation call that follows.
- **Fallback:** if the feed is unreachable or empty, the slot degrades to a `planned` post so the pipeline never dead-ends. `Post.sourceNewsUrl` stays null and nothing claims a source that doesn't exist.

**`planGenerator.js`** → `generateContentPlan({ user, durationDays })`
- Pure helper `buildPlanSlots({ durationDays, postFrequency, newsPostsPerWeek })` first — **unit-testable, no I/O**, contains the content-mix math from §1 with a full JSDoc block. Then one `responses.parse` call fills in `theme` per slot (prompted with `user.niche` + `user.inputPoints`), preserving the type assignment from the helper.
- Themes must be distinct and specific — instructed in the system prompt, and the theme-per-slot list is passed back in.
- Writes `ContentPlan` with `status: 'draft'`, then `'approved'` via `PATCH /api/plans/:id/approve`.
- Cost guard: `quotaService.consume(userId, 'planGenerations')` before the call.

**`newsAgent.js`** → `findNicheNews({ user })`
- `responses.parse({ model: NEWS_MODEL, tools: [{ type: 'web_search', search_context_size: 'medium', filters: { blocked_domains: [...] } }], text: { format: zodTextFormat(NewsStorySchema, 'news_story') } })`.
- **Anti-hallucination check:** after parsing, cross-reference `sourceUrl` against the `url_citation` annotations in `message.content[0].annotations` (and/or `web_search_call.action.sources` via `include: ['web_search_call.action.sources']`). If the URL isn't in the retrieved sources, discard it and retry once; on second failure fall back to generating a `planned`-style post so the pipeline never dead-ends.
- Returns the story **and** the full source list so `Post.sourceNewsUrl` is always a genuinely retrieved URL.
- `quotaService.consume(userId, 'newsLookups')` before the call.

**`postGenerator.js`** → `generatePost({ user, plan, slot, platform, existingNews? })`
- Builds the prompt from niche + `inputPoints` + slot theme, with platform-specific hard constraints from `PLATFORM_LIMITS` and `utils/text.js`.
- For `type: 'news'`, calls `rssNews.fetchNicheNews` first (passing `existingNews` on a regenerate so a reject doesn't re-fetch and re-summarise), then generates against the chosen story. The model's job is only to *comment on* a story that already exists with a real URL — it never invents the story or the link.
- Returns validated draft; `utils/text.js#enforcePlatformLimit()` is the last word — truncates on a sentence boundary and logs when it does.
- Creates the `Post` doc (`status: 'pending_approval'`, `publishMethod: 'assisted'`, `regenerationCount: 0`).

### 6.3 Module: `services/discord/` — approval loop

**`client.js`** — discord.js `Client` with `GatewayIntentBits.DirectMessages`; `login()`; `ready` handler logs the tag; `error`/`warn` routed to `utils/logger.js`.

**`approvalQueue.js`** → `queuePostForApproval(post)`
- Resolves `user.discordUserId`, opens a DM channel, sends an embed:
  - Title: `Day {dayIndex} — {theme}`; fields for platform, type (`planned`/`news`), char count vs limit, and the news source link when `type === 'news'`.
  - Body: the post text in a fenced ```` ``` ```` code block — **this is the mechanism that makes "one action" work**, since Discord renders a native *Copy* button on code blocks. No OS clipboard access is available to a bot, so this is the only correct way to deliver copy-pasteable text.
  - Buttons: `post:approve:{id}` (Success), `post:reject:{id}` (Danger), `post:edit:{id}` (Secondary).
  - Phase 3: `AttachmentBuilder` for the generated image, plus a download URL.
- Persists `discordMessageId`.

**`interactions.js`** — button/modal router, `customId` = `post:<action>:<postId>`:
- **Always `deferUpdate()` first.** Discord's 3-second interaction deadline is far shorter than a regeneration call; without the defer, Reject silently fails.
- **Approve** → guard `post.status === 'pending_approval'` (idempotent, blocks double-clicks) → `publishPost(post)` → set `status: 'approved'`, `publishedAt` → edit the original message, removing the buttons so it can't be actioned twice, and appending the publish block from §6.4.
- **Reject** → `status: 'rejected'` → if `regenerationCount < MAX_REGENERATIONS_PER_POST`, regenerate (`planService.regeneratePost`) and send a fresh approval message; otherwise reply that the slot is parked, and mark the slot `pending` for the next cycle.
- **Edit** → `ModalBuilder` + `TextInputBuilder` (Paragraph style, `maxLength` = platform limit, pre-filled with current content) → on submit, update `post.content` and re-render the approval message in place.

### 6.4 Module: `services/publishing/` — assisted publish

**`index.js`** → `publishPost(post)` — dispatcher keyed on `post.platform`. Returns `{ instructions, links }`; contains no platform logic itself. **This is the swap point named in PRD §2/§6** — when LinkedIn API access or X billing lands, only the branch target changes.

**`xPublisher.js`** → `buildXAssistUrl(content)` — `https://x.com/intent/post?text=<encodeURIComponent(content)>` (X's compose-intent link *does* prefill text). Built with `URL`/`URLSearchParams`; if the encoded URL exceeds ~2000 chars, omit the link and fall back to the copy block only.

**`linkedinPublisher.js`** → `buildLinkedInAssist(content)` — returns the composer URL (`https://www.linkedin.com/feed/?shareActive=true`) plus the text for the copy block. Per PRD §2 there is **no** way to prefill LinkedIn post text without the API; do not attempt it, and do not add browser automation (violates both platforms' terms and risks the *user's* account).

Both return a uniform shape so the Discord message renders identically for each platform:
```
✅ Approved — one step to publish
<copyable code block>
[➡️ Open X composer]  [🖼️ Download image]   ← image button only when one exists
```

### 6.5 Scheduler + orchestration

**`services/planService.js`**
- `createPlan(userId, durationDays)` → `buildPlanSlots` + `generateContentPlan` + persist.
- `generateDayPost({ userId, planId, dayIndex, platform })` → the full slot pipeline: generate text → Phase 3 image (if flagged) → `queuePostForApproval` → mark slot `generated`.
- `regeneratePost(postId)` → increments `regenerationCount`, reuses cached news where possible, creates a new `Post` linked to the same slot.
- `generateNextSlot(userId)` → finds the lowest `dayIndex` with `status: 'pending'`, generates both platforms. Returns `null` when the plan is exhausted; if `autoRenewPlan` is on, rolls into a fresh plan.

**`jobs/dailyPostJob.js`** — `runDailyJob({ triggeredBy })`: for each active user with an `approved` plan, `generateNextSlot`. Per-user try/catch so one bad user can't kill the run. Skips users with no connected `discordUserId` (with a log line). Writes a run summary.

**`jobs/scheduler.js`** — `node-cron` on `CRON_DAILY_POST_SCHEDULE` (default `0 9 * * *`), guarded against overlapping runs. **node-cron over BullMQ+Redis:** Phase 1 has no Redis requirement and one job/day per user doesn't need a queue; `dailyPostJob` is written as a plain idempotent function so swapping in BullMQ later is a drop-in.

**`routes/devRoutes.js`** — gated behind `DEV_TOOLS_ENABLED` + JWT: `POST /api/dev/scheduler/run`, `POST /api/dev/plans/:id/slot/:dayIndex`, `POST /api/dev/plans/:id/reset`. Without these you cannot demo the loop without waiting a day per post.

### 6.6 API surface

`POST /api/auth/register|login`, `POST /api/auth/discord/link-code` · `GET|PATCH /api/users/me` (niche, `inputPoints`, `postFrequency`) · `POST /api/plans`, `GET /api/plans`, `GET /api/plans/:id`, `PATCH /api/plans/:id/approve`, `POST /api/plans/:id/generate` · `GET /api/posts?status=`, `GET /api/posts/:id` · `GET /health`.

### 6.7 PHASE 1 acceptance
- `npm run probe` passes on all checks.
- `seed → PATCH /plans/:id/approve → POST /api/dev/scheduler/run` produces both an X and a LinkedIn draft, delivered as Discord DMs with working buttons.
- Reject regenerates and re-sends, up to the cap, without exceeding quota.
- Approve returns the composer link + copy block and removes the buttons.
- A news slot stores a `sourceNewsUrl` that appears in the model's retrieved citations.
- `npm test` covers `buildPlanSlots` (7/30 days × 2/3/4 per week: correct slot count, exactly 1 news/week, no duplicate `dayIndex`) and `utils/text.js` truncation.

---

## 7. PHASE 3 — Image generation ✅ BUILT

> ## ✅ BUILT — on OpenAI, not Gemini. See §0.6 for what actually shipped.
>
> **Why the deferral was lifted:** this section was deferred under amendment A3 because
> every **Gemini** image model returned `429 limit: 0` on the Google key. §0.5 then switched
> the provider to OpenAI, where `gpt-image-1` has quota — verified again before the build
> (one 1024x1024 image, 70KB, 15.6s). The content below is kept as the original
> specification; §0.6 records the three deviations the build produced, plus the Discord
> attachment behaviour that only showed up when it ran.
>
> **What had already shipped and was reused as predicted:** the `Post` schema fields
> `needsImage`, `imagePrompt`, `imageGeneratedAt`, `imageUrl`, `IMAGE_SIZES`, the
> `generateImage()` slot in the provider interface and the static `/media` route. Phase 3
> needed **no data migration**; one field (`imageSkipReason`) was added alongside the code.
>
> **Gemini's image branch is written but unexercised** — that key still has zero image
> quota. Switching `AI_PROVIDER=gemini` will not silently lose images; it will attempt the
> call and degrade to text-only with the note, exactly as a refusal does.

**Step 3.1 — `services/ai/imageGenerator.js`** → `generateImageForPost(post)`
- Model from `IMAGE_MODEL`. For the Gemini provider the call is `generateContent` with the image model (Imagen is retired — it shut down 2026-08-17) and the bytes come out of `candidates[0].content.parts[].inlineData.data` as base64. For an OpenAI key it is `images.generate`. Either way, keep it an env var and let `probe` be the single place that validates the model name.
- `openai.images.generate({ model, prompt, size: IMAGE_SIZES[post.platform], quality: 'medium', output_format: 'jpeg' })` using `constants.IMAGE_SIZES` (multiples of 16, aspect ratio between 1:3 and 3:1, per the API's custom-dimension rules). Base64 → `Buffer` → `media/{postId}.jpg`.
- Prompt is built from `post.imagePrompt` (model-authored at generation time) + niche, plus a constraining style suffix for brand consistency. Guard against text-in-image requests, which the model still handles unreliably.
- Sets `post.imageUrl = {PUBLIC_BASE_URL}/media/{postId}.jpg` and `imageGeneratedAt`.

**Step 3.2 — Wire into the pipeline.** In `planService.generateDayPost`, after text validation and *before* `queuePostForApproval` — PRD §6 Phase 3 "done when": *eligible posts get an image attached before hitting the Discord queue.*

**Step 3.3 — Quota.** `quotaService.consume(userId, 'images')` against `QUOTAS.imagesPerUserPerWeek` **before** the API call (never after — a failed consume must not still bill). On quota exhaustion the post still queues, text-only, with a note. Reason from PRD §7: images are the expensive call, so the cap is the primary cost control.

**Step 3.4 — Attachment.** `approvalQueue` attaches the file via `AttachmentBuilder` alongside the download link, so the user can save it for the manual platform post.

**Step 3.5 — Failure handling.** Catch `moderation_blocked` and read `error.error.moderation_details.categories` / `.moderation_stage`; log details for the developer, show the user a generic message, and **do not auto-retry** — queue the post text-only. Same for timeouts (generation can take up to ~2 min): time out at 120s, log, continue text-only. An image failure must never block approval.

**Step 3.6 — PHASE 3 acceptance**
- Setup: `needsImage: true` posts get a correctly-sized image in the Discord DM *and* a reachable `imageUrl`.
- The weekly cap blocks the 6th image and degrades gracefully instead of erroring.
- A `moderation_blocked` prompt leaves the post queueable with no retry storm.
- `GenerationLog` shows image token/cost rows per user.

---

## 8. Cross-cutting

**Quotas (PRD §7):** all counters via `quotaService`, all consumed **before** the paid call, keyed `(userId, key, periodStart)` with a unique index so concurrent runs can't double-spend. `planGenerations`/`newsLookups` daily; `images` weekly.

**Secrets:** `.env` only, never logged. Add a redaction helper in `utils/logger.js`. Confirm outbound HTTPS to `api.openai.com` and `discord.com` isn't firewalled on the university server (PRD §8).

**Model config:** `TEXT_MODEL`, `NEWS_MODEL`, `IMAGE_MODEL` all env-driven with a documented default. Don't hardcode a model name anywhere in `src/` — the catalog moves fast and `probe` is the single place that validates them.

**Error handling:** Express 5 propagates async rejections to `errorHandler.js` natively. `ApiError` carries `statusCode`; unknown errors log the stack server-side and return a generic body. Discord errors must never crash the process — wrap all handlers.

**Out of scope (do not build):** PRD Phase 2 (LinkedIn API OAuth + swap of the publisher branch), PRD Phase 4 (Veo video — and never Sora, retired Sep 2026), Stripe, the Next.js dashboard, BullMQ/Redis, and any browser automation.

---

## 9. Verification

1. **§2 checklist fully ticked** (human gate) → then `npm run probe` all PASS (machine gate). **If the OpenAI line fails on a model name, that's the env var to change, not the code.**
2. `npm test` — `buildPlanSlots` matrix + text truncation pass.
3. **Full loop demo:** `npm run seed` → approve the plan → `POST /api/dev/scheduler/run` → drafts land in Discord DMs.
4. Walk one draft: **Reject** (confirm regeneration + re-send), then **Edit** (confirm modal prefill + in-place re-render), then **Approve** (confirm buttons disappear and the composer link + copy block appear).
5. Confirm one X and one LinkedIn post exist for the same `dayIndex`, with `publishMethod: 'assisted'` on both.
6. Let a news slot run; verify `sourceNewsUrl` matches a real retrieved citation and that the model didn't invent the URL.
7. Phase 3: force `needsImage: true`, confirm the sized image arrives in Discord + the `/media` URL resolves in a browser; then burn the weekly cap and confirm graceful text-only degradation.
8. Query `GenerationLog` grouped by user — this is the PRD §7 cost table and the report's evidence.
