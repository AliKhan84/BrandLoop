# BrandLoop — Prerequisites Checklist

**Purpose:** everything that must exist before any application code is written.
**Related:** [`IMPLEMENTATION-PLAN.md`](./IMPLEMENTATION-PLAN.md) §2 and §2.6.

---

## How to use this file

1. Work through sections **1–4** below, top to bottom. Each box has the exact location of the value — no guessing.
2. Put every value into `D:\projects\BrandLoop\.env` as you go (table at the bottom tells you the exact variable names).
3. When all boxes are ticked, tell the agent: **"the prerequisites checklist is clear."**
4. The agent then builds the scaffold + `scripts/probe.js`, and runs `npm run probe` to verify every credential programmatically.

**Anything below still missing when the probe runs will be reported as a FAIL — it will not be stubbed out.** A stubbed Discord would hide the DM-flow bugs that are the entire point of Phase 1.

### Progress

| Section | Done | Total |
|---|---|---|
| 1. OpenAI | 0 | 5 |
| 2. Discord | 0 | 7 |
| 3. MongoDB | 0 | 4 |
| 4. Local | 0 | 3 |
| **Total** | **0** | **19** |

---

## 1. OpenAI

### 1.1 — Regenerate the API key
- [ ] Go to `https://platform.openai.com/api-keys` → **Create new secret key**.

**Why:** the key currently in `.env` is unusable. It reads
`openai_api_key=sk-VbI6…ytzcA U` — that's three separate problems:
1. the variable name is lowercase (`openai_api_key`, not `OPENAI_API_KEY`);
2. there's a stray `" U"` stuck on the end, which will be sent as part of the key;
3. it uses the legacy `sk-` format from before OpenAI split keys into projects (`sk-proj-…`).

### 1.2 — Put it in `.env`
- [ ] Edit `D:\projects\BrandLoop\.env`. It must read exactly:

```
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxx
```

Rules: **uppercase name**, no quotes around the value, no trailing spaces, nothing after the key. The probe checks for stray whitespace specifically, because it's the single most common cause of a `401`.

### 1.3 — Confirm billing is active
- [ ] `https://platform.openai.com/settings/organization/billing` → confirm a payment method and non-zero credit.

**Why:** Phase 1 makes real paid calls on every plan, every post, and (in Phase 3) every image. A key with no billing returns `429 insufficient_quota`, which looks like a rate limit but isn't.

### 1.4 — Start Organization Verification
- [ ] `https://platform.openai.com/settings/organization/general` → **Verify Organization** → complete the process.
- [ ] Note the date you submitted: ______________

**Why:** GPT Image models (Phase 3) may return **403** until this is done. Phase 1 does not need it at all. Approval is not instant, so submitting now means it may already be through by the time Phase 3 starts. If it's still pending then, Phase 3 gets built and the block is reported rather than silently swallowed.

### 1.5 — Set a hard spend cap
- [ ] `https://platform.openai.com/settings/organization/limits` → set a monthly budget and a hard limit.

**Why:** PRD §7 requires this before any public or demo link goes out. It's also the backstop for the per-user quotas the app enforces internally — two independent layers so a bug in one can't produce a runaway bill.

---

## 2. Discord

### 2.1 — Create the application
- [ ] `https://discord.com/developers/applications` → **New Application** → name it `BrandLoop`.

### 2.2 — Get the bot token
- [ ] Left sidebar → **Bot** tab → **Add Bot** → **Reset Token** → **Copy**.
- [ ] Paste into `.env` as `DISCORD_BOT_TOKEN=…`

**Gotcha:** the token is shown exactly once. If you lose it, reset it again. Treat it like a password — it grants full control of the bot.

### 2.3 — Get the Application ID
- [ ] Left sidebar → **General Information** → copy **Application ID** (a long number).
- [ ] Paste into `.env` as `DISCORD_APP_ID=…`

**Why it's needed:** discord.js uses it to register the `/connect`, `/status`, and `/plan` slash commands. Wrong or missing → commands never appear in Discord.

### 2.4 — Enable the Message Content Intent
- [ ] **Bot** tab → **Privileged Gateway Intents** → toggle **Message Content Intent** ON → **Save Changes**.

**Why:** required by discord.js v14 for a bot that reads message content.

### 2.5 — Enable Direct Messages in Installation settings
- [ ] Left sidebar → **Installation** → under **Installation Contexts**, tick **User Install**.
- [ ] Under **Default Install Settings** → select scopes **`bot`** and **`applications.commands`**.

**Why:** this is the one people miss. Without User Install + DM support, users physically cannot DM the bot, and the entire per-user DM approval flow is impossible. Your PRD chose DM delivery, so this is load-bearing.

### 2.6 — Install the bot on a test server
- [ ] **Installation** tab → copy the **Install Link**.
- [ ] Open it in a browser, pick a test server you own, authorise.

**Why:** Discord requires a **mutual server** between bot and user before the bot can open a DM channel. No mutual server → `Cannot send messages to this user`.

### 2.7 — Enable Developer Mode
- [ ] Discord client → **Settings** → **Advanced** → toggle **Developer Mode** ON.

**Why:** lets you right-click your own name → **Copy User ID** for manual testing, and right-click messages → **Copy Message ID** to debug the approval queue. Also lets you invoke `/connect` from your own DM with the bot.

---

## 3. MongoDB

### 3.1 — Create the cluster
- [ ] `https://cloud.mongodb.com` → create an account → **Build a Database** → **M0 FREE** tier.
- [ ] Pick a region close to you. Name it whatever (e.g. `BrandLoopCluster`).

### 3.2 — Create a database user
- [ ] Left sidebar → **Database Access** → **Add New Database User**.
- [ ] Authentication: **Password**. Username e.g. `brandloop-admin`.
- [ ] Generate a secure password and **save it now**.
- [ ] Built-in Role: **Read and write to any database**.

### 3.3 — Allow-list your IP
- [ ] Left sidebar → **Network Access** → **Add IP Address** → **Add Current IP Address**.

**Dev-only shortcut:** `0.0.0.0/0` allows any IP. Fine while developing, but tighten it before deploying to the university server (PRD §8).

### 3.4 — Assemble the connection string
- [ ] Cluster → **Connect** → **Drivers** → copy the SRV string.
- [ ] Substitute `<password>` with the real password from 3.2.
- [ ] Add a database name before the `?`.
- [ ] Add to `.env` as `MONGODB_URI=…`

Shape it must match:

```
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/brandloop?retryWrites=true&w=majority
```

Three things that break this string, in order of frequency:
1. `<password>` left in literally — angle brackets and all.
2. Password containing `@`, `:`, `/`, or `#` — these must be **percent-encoded** (`@` → `%40`).
3. No database name between `.net/` and `?` — Mongo connects but drops everything in a default `test` database.

---

## 4. Local environment

### 4.1 — Node.js 20 or newer
- [ ] Run `node -v`. Must print `v20.x` or higher.

**Why:** discord.js v14 and the OpenAI SDK both require Node 20+. Node 18 produces confusing `ERR_REQUIRE_ESM` / fetch errors rather than a clean version message.

### 4.2 — JWT secret
- [ ] `.env` → `JWT_SECRET=…` — any long random string. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

**Why:** signs the login tokens. A short or guessable secret means anyone can forge a session.

### 4.3 — Outbound network access
- [ ] Confirm your network isn't blocking HTTPS to `api.openai.com` and `discord.com`.

```bash
curl -sS -o /dev/null -w "openai: %{http_code}\n" https://api.openai.com/v1/models
curl -sS -o /dev/null -w "discord: %{http_code}\n" https://discord.com/api/v10/gateway
```

A `401` from OpenAI is a **pass** — it means the request reached OpenAI and was rejected only for lack of a key. What you're ruling out is a timeout or connection refusal. The Discord endpoint should return `200`.

**Why:** PRD §8 flags this for the university server. Better to find out now than on deploy day.

---

## 5. Reference — final `.env` shape

Your `.env` should end up looking like this (values replaced with your real ones):

```bash
# ── Required ───────────────────────────────────────────────
OPENAI_API_KEY=sk-proj-...
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/brandloop?retryWrites=true&w=majority
DISCORD_BOT_TOKEN=...
DISCORD_APP_ID=...
JWT_SECRET=...

# ── Optional — sensible defaults, set only to override ──────
# TEXT_MODEL=gpt-5-mini            # plan + post generation
# NEWS_MODEL=gpt-5-mini            # Responses API web_search lookups
# IMAGE_MODEL=gpt-image-2          # Phase 3; gpt-image-2.5-flare / -sunburst are newer
# PORT=3000
# PUBLIC_BASE_URL=http://localhost:3000
# CRON_DAILY_POST_SCHEDULE=0 9 * * *
# DEV_TOOLS_ENABLED=true           # enables /api/dev/* manual triggers — dev only
# DISCORD_LINK_CODE_TTL_MIN=15
# MAX_REGENERATIONS_PER_POST=3
```

The agent writes `.env.example` with all of these documented in Step 0.3. It also keeps a fallback that reads the legacy lowercase `openai_api_key`, so nothing breaks mid-migration.

`.env` is gitignored in Step 0.1 — **it will never be committed.** Never paste its contents into a chat, an issue, or a screenshot.

---

## 6. When you're done

Say: **"the prerequisites checklist is clear."**

The agent then runs Steps 0.1–0.6 (scaffold, config, DB models, probe script — still no app logic) and executes `npm run probe`, which verifies each credential for real and prints PASS/FAIL per line. Anything failing gets reported with the specific fix. Everything passing → Phase 1 and Phase 3 build straight through.
