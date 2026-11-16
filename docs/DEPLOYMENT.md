# Deployment

Two Docker images, one compose file, and the honest state of free hosting —
checked **September 2026**, because most of these numbers move every year and
several of them moved against self-hosters in 2026.

Read §1 first. Every option in §2 is judged against those constraints, and the
constraints are what make the answer non-obvious: the API is not a normal web
service.

---

## 1. What a host has to provide

| Requirement | Why | What breaks without it |
|---|---|---|
| **A process that never sleeps** | The Discord gateway is a WebSocket, and the daily generation job is `node-cron` inside the same process (`CRON_DAILY_POST_SCHEDULE`, default `0 9 * * *`). Neither is triggered by an HTTP request. | The bot goes offline, and `/connect` stops answering. The scheduler never fires, so no drafts are ever generated — silently, because nothing errors. |
| **A disk that survives a redeploy** | `media/{postId}.jpg` is written by the image generator and served at `/media/…`. | The Discord DM still shows its picture (Discord hosts its own copy of an attachment) while the dashboard's LinkedIn compose page shows a broken image. That inconsistency reads as a bug and is the reason this is a hard requirement rather than a nice-to-have. |
| **Two public HTTPS URLs** | `PUBLIC_BASE_URL` builds links to generated images and `DASHBOARD_BASE_URL` is the LinkedIn copy-and-open page. Both are pasted into Discord as links a user clicks. | The links arrive as `http://localhost:3000/...` and do nothing on the recipient's machine. |
| **Outbound HTTPS** | Atlas, the AI provider, and Google News RSS. | Start-up fails outright on Atlas; news posts fall back to planned ones (gotcha 6.4 is the other half of that story). |
| **The host's IP in Atlas Network Access** | The connection string is credential-based but the cluster is IP-gated. | `MongoServerSelectionError` at boot, which looks like a bad password. |

### Measured footprint

From the verification run of both containers (`docker stats`-equivalent, via the
Docker MCP tools, September 2026):

| Container | Memory | Image size |
|---|---|---|
| API + Discord + scheduler | **85 MB** | 437 MB |
| Dashboard | **48 MB** | 380 MB |

Both fit comfortably on the smallest instance any of the hosts below offer, and
the 512 MB that a free Render service provides is not a constraint. What rules
hosts out is the sleeping, never the size.

---

## 2. The options, checked September 2026

| Host | Free tier | Always-on | Files persist | Verdict |
|---|---|---|---|---|
| **University server** (PRD §8) | Yes — the machine already exists | Yes | Yes | **The plan already.** Free, always-on, and it already runs Nginx + PM2 + Certbot. Best path; see §5. |
| **Oracle Cloud Always Free** | Yes, permanently | Yes | Yes | **The best genuinely free VM.** Ampere A1 was *halved* on 15 June 2026 — 4 OCPU / 24 GB became **2 OCPU / 12 GB** — but it is still always-free, alongside a small AMD micro instance and block storage. Signup is the friction: card verification and, anecdotally, rejected applications. |
| **Google Cloud Always Free** | Yes, permanently | Yes | Yes | One **e2-micro in `us-west1`, `us-east1` or `us-central1`** plus 30 GB of standard disk. 1 GB of RAM against a measured 133 MB is fine for both containers. Region-locked and US-only, which is a latency question rather than a correctness one. Runbook: §7. |
| **Render (free plan)** | Yes | **No** — sleeps after 15 idle minutes, ~1 min to wake | No — ephemeral filesystem | Good for the **dashboard**, which can sleep. For the API it breaks both the gateway and the schedule. Keeping it awake with a ping works and is widely done, but 24/7 pinging consumes ~744 of the **750 instance hours** a workspace gets per month, leaving no headroom. Treat as fragile. |
| **Vercel (Hobby)** | Yes | n/a — serverless | No | **Dashboard only.** Hosting it here works well (it is a Next.js app, and `lib/api.ts` is server-only, so the API base URL stays server-side). The terms are personal/non-commercial, which a university project is; the API and bot cannot run here at all. |
| **Home machine + Cloudflare Tunnel** | Yes | Yes, while it is on | Yes | The tunnel gives a public HTTPS hostname with no open ports and no static IP. Costs nothing but your own power and uptime. |
| **GitHub Student Developer Pack** | Yes, if verified as a student | Varies | Varies | Worth claiming before anything else — it includes Azure credit (~$100) and JetBrains, though the DigitalOcean credit that used to be the headline benefit is reported to have been withdrawn in 2026. Check the pack's own page; the offers change yearly. |
| Fly.io | **No** — trial, then pay-as-you-go | — | — | The free allowance is gone. |
| Railway | **No** — a one-time $5 trial credit | — | — | Same. |
| Heroku | **No** — nothing free since 2022, and the $5 Eco dyno sleeps | — | — | Same. |
| Koyeb | Reported **closed to new users** after the Mistral acquisition | — | — | Do not plan around it. |

**The one-line summary:** for a free, always-on, file-persisting host, you are
choosing between a machine you already have (the university server), a free VM
(Oracle or GCP), or your own hardware behind a tunnel. Every container platform
with a permanent free tier either sleeps or has stopped offering one — and a
sleeping host silently kills the scheduler and the Discord connection.

---

## 3. Three combinations that work

**A. University server — the planned deployment (recommended).**
Both containers under compose, TLS from the Certbot setup that is already there.
See §5.

**B. One free VM: Oracle Always Free or GCP e2-micro.**
Install Docker, clone the repo, `docker compose up -d --build`, put Nginx +
Certbot in front (or Cloudflare Tunnel, which skips the certificate entirely).
Set `PUBLIC_BASE_URL` and `DASHBOARD_BASE_URL` to the public hostname. Add the
VM's IP to Atlas Network Access — and while you are there, drop the
`0.0.0.0/0` dev shortcut from PREREQUISITES §3.3.

**§7 is this on GCP, step by step, and it is the combination this project
deploys as** — both containers on the one VM, chosen over C for the reasons
recorded at the top of §7. One deviation: it `pull`s the published images rather
than building them, because a Next.js production build wants more memory than a
1 GB instance has.

**C. Split: dashboard on Vercel Hobby, API on a small always-on host.**
Only worth it if you want a managed dashboard. The dashboard needs
`API_BASE_URL` pointed at the API's public URL, and the API needs
`DASHBOARD_BASE_URL` pointed back, so both must be reachable from the internet.
This works — the dashboard is a backend-for-frontend, so the browser never calls
the API and no CORS is involved — but it is not the path taken here; §7's
opening note records what it costs.

---

## 4. Docker

### What is here

| File | What it builds |
|---|---|
| `Dockerfile` | The API: Express, the Discord gateway client and the scheduler in one process. Runs as the non-root `node` user, listens on 8080. |
| `dashboard/Dockerfile` | The dashboard: a Next.js standalone server on port 3000, also non-root. |
| `docker-compose.yml` | Both services, the media volume, and the healthchecks. |
| `.dockerignore`, `dashboard/.dockerignore` | Keep `.env`, `node_modules` and build output out of the build context. |

### Commands

```bash
docker compose up -d --build          # start both, wait for healthchecks
docker compose pull                   # fetch the published images instead of building
docker compose ps                     # health and published ports
docker compose logs -f api            # follow the bot: gateway, DB, scheduler
docker compose run --rm api npm run seed     # demo account and fixture data
docker compose run --rm api npm run probe    # validate models and credentials
docker compose down                   # stop; the media volume survives
docker compose down -v                # stop and delete the volume as well
```

`docker compose up -d --wait` is what the verification used: it blocks until both
containers report healthy instead of returning the moment they start.

### Pulling the published images

`.github/workflows/publish-images.yml` builds and pushes both images to GHCR on
every push to `main`, so a machine that only needs to *run* the app never has to
build it:

```bash
docker compose pull          # both images, using the names in docker-compose.yml
```

The two images are also pullable by hand:

```bash
docker pull ghcr.io/alikhan84/brandloop-api:latest
docker pull ghcr.io/alikhan84/brandloop-dashboard:latest
```

**GHCR rather than Docker Hub, and why.** The workflow authenticates with its own
`GITHUB_TOKEN`, so there is no long-lived registry credential stored in the
repository — nothing extra to leak, rotate or forget. Docker Hub would need an
account token kept as a repository secret, and it applies pull-rate limits to
free accounts. Add it only if whoever consumes the image expects to pull it from
Docker Hub by name; it costs a login step and two extra `build-push-action`
inputs, and the two registries can coexist without changing anything else.

Two things to know about the published images:

- **A new package is private, even though the repository is public.** To let
  anyone pull without signing in, set its visibility to public under the
  repository's Packages tab after the first successful run.
- **They are `linux/amd64` only.** On an ARM host — Oracle's free tier, an
  M-series Mac — use `docker compose up -d --build`, which builds natively.

### One-time setup in GitHub

Two settings live in the repository's own configuration rather than in this file,
and both are easy to forget because nothing fails loudly without them:

**1. The Discord install link, as an Actions variable.**
Settings → Secrets and variables → Actions → Variables → *New repository
variable*:

```
NEXT_PUBLIC_DISCORD_INSTALL_URL = https://discord.com/oauth2/authorize?client_id=<your-app-id>&integration_type=1&scope=applications.commands
```

`<your-app-id>` is the same client id as `DISCORD_APP_ID` in `.env`. It is not a
secret — it appears in every OAuth link the bot hands out.

This is a **build** argument, so an image built without it has a button that goes
nowhere: no error, no failing step, just a dead link. Compose reads the value
from `.env` for local builds; the workflow reads it from the variable. After
setting it, republish the images with Actions → *Publish images* → *Run workflow*
— `workflow_dispatch` exists precisely so this does not need an empty commit.

**2. Package visibility.**
A new GHCR package is **private**, even though the repository is public. To let
anyone pull without signing in, set it to public on the package's settings page
under *Danger Zone → Change package visibility*.

### Configuration

`.env` next to the compose file is the API container's environment — the whole
file, as environment variables rather than a mounted file, because `env.js`
calls dotenv with `override: true` and a mounted `.env` would silently beat
anything set in compose.

The dashboard needs exactly two things:

- `API_BASE_URL=http://api:8080` — service-name DNS inside the compose network.
  This is set in the compose file, not in `.env`.
- `NEXT_PUBLIC_DISCORD_INSTALL_URL` — **a build argument, not a run-time
  variable.** Next inlines every `NEXT_PUBLIC_*` value during `next build`, so
  setting it only at run time leaves the "Add to Discord" button with an empty
  `href`. Compose reads it from `.env` and passes it as a build arg; changing it
  requires a rebuild (`docker compose build dashboard`).

### Two things that are deliberate

**No database container.** MongoDB is Atlas and PRD §8 keeps it off the
application host. A local mongo service would be a second database with
different data that nobody deploys.

**No reverse proxy.** The documented deployment already terminates TLS with
Nginx and Certbot; a second proxy in the compose file would mean two services
disagreeing about who owns the certificate.

### Demos

`NODE_ENV=production` force-disables the manual `/api/dev/*` triggers by design
(see `env.js`). To drive the pipeline a slot at a time in front of an audience,
set `NODE_ENV: development` on the `api` service — the compose file says so in a
comment. Everything else behaves the same.

---

## 5. Behind Nginx (the PRD's deployment)

Compose publishes 8080 and 3000 on the host; Nginx proxies the two public names
to them. The shape, with the parts that matter called out:

```nginx
# API — serves /media and the REST endpoints. Discord links point here, so this
# is the hostname that must match PUBLIC_BASE_URL.
server {
    listen 443 ssl;
    server_name api.example.com;
    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Dashboard. Must match DASHBOARD_BASE_URL, because the LinkedIn copy-and-open
# page is reached by a link the bot DMs.
server {
    listen 443 ssl;
    server_name app.example.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

`app.js` already sets `trust proxy`, so `req.ip` is the real client rather than
the proxy once these headers arrive. Certificates come from the existing
Certbot setup — `certbot --nginx -d api.example.com -d app.example.com`.

---

## 6. When it goes wrong

**The build fails on `apt-get` with `403 Forbidden` from `deb.debian.org`.**
This network blocks the Debian mirror. That is why the API's build stage uses
the **full** `node:22-bookworm` image rather than `-slim`: buildpack-deps
already carries python3/make/g++, so nothing needs to be installed while
building. If you add a package that genuinely needs `apt-get`, expect this
failure and fix it at the network, not in the Dockerfile.

**`.env` values arrive with a stray character.** Docker's env-file parser keeps
a trailing `\r`, so a `.env` edited on Windows with CRLF endings produces a
connection string with an invisible character at the end. The repo pins LF
(`.gitattributes`), so this only happens to a file edited by hand — write it as
LF, or edit it in a way that preserves the ending.

**`driver failed programming external connectivity: port is already allocated`.**
A local `npm start` or `npm run dev` is still running. Stop it, or change the
published port.

**`MongoServerSelectionError` at boot.** The host's IP is not in Atlas → Network
Access → IP Access List. Not a credentials problem, despite how it reads.

**The `/api/dev/*` triggers return 404.** `NODE_ENV=production` disables them on
purpose; see §4.

**A generated image 404s after a redeploy.** The container was replaced without
a volume. Compose defines one (`media`), so this means something ran without it
— check that the volume is still listed by `docker volume ls`.

---

## 7. GCP e2-micro, step by step

Combination B of §3, executed: **both containers on one Always Free VM**, with
Nginx and Certbot (§5) in front of them. Written to be followed top to bottom on
a fresh project. The steps that are easy to get wrong — the disk type, and which
ports the firewall opens — carry their reason inline.

**Why both containers on one VM, and not the split in C.** The dashboard is 48 MB
against the API's 85 MB, on a machine whose free tier gives 1 GB, so a second
container is not what makes the instance small — the sleeping is what rules hosts
out (§1), and neither container sleeps here. What the split costs instead is
three settings that must agree character for character: `API_BASE_URL`
(dashboard → this VM), `DASHBOARD_BASE_URL` (this VM → dashboard, because the
LinkedIn link *and* the Google redirect URI are built from it), and that same
redirect URI registered in the Google console. It also puts a serverless
function's duration cap underneath a Generate call that legitimately takes 30-60
seconds. The split genuinely works — the dashboard is a backend-for-frontend, so
the browser never calls the API and there is no CORS to arrange — but what it
buys is a managed dashboard, which is not a thing this deployment needs.

### 7.1 The instance

```bash
# One project, one region. The free e2-micro exists in these three regions only.
gcloud config set project <project-id>
gcloud config set compute/region us-central1

# A static address, so DNS (7.3) and the Atlas allowlist (7.2) are written once.
# Attached to a running instance it is free; left behind after you delete the VM
# it is billed, so release it in that case.
gcloud compute addresses create brandloop-ip --region=us-central1
gcloud compute addresses describe brandloop-ip --region=us-central1 \
  --format='get(address)'

# e2-micro is the free machine shape. `pd-standard` at 30 GB is the free disk —
# `pd-balanced`, or any larger size, bills from the first byte.
gcloud compute instances create brandloop \
  --machine-type=e2-micro \
  --zone=us-central1-a \
  --image-family=debian-12 --image-project=debian-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-standard \
  --address=brandloop-ip \
  --tags=http-server,https-server
```

Those two tags are what the default network's own `default-allow-http` and
`default-allow-https` rules match, so 80 and 443 are reachable as soon as the
instance is. **Do not open 8080 or 3000.** Compose publishes both on the host,
and the firewall is the only thing keeping them off the internet — Nginx reaches
them over `127.0.0.1`. If the project has no such rules:

```bash
gcloud compute firewall-rules create allow-web \
  --allow=tcp:80,tcp:443 --target-tags=http-server,https-server
```

Then `gcloud compute ssh brandloop --zone=us-central1-a`.

### 7.2 Atlas, before the first boot

Add the address from 7.1 to Atlas → Network Access, and while you are there drop
the `0.0.0.0/0` development shortcut from PREREQUISITES §3.3. Doing it now means
the first boot is clean; skipping it produces `MongoServerSelectionError`, which
reads like a wrong password and is not.

### 7.3 DNS

Two A records pointing at that address — `api.example.com` and
`app.example.com`. Certificate issuance in 7.7 fails until both resolve, so
`dig +short` them before moving on.

### 7.4 Docker

A cloud image is minimal, so this starts with the packages it lacks:

```bash
sudo apt-get update
sudo apt-get install -y git curl ca-certificates
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER" && newgrp docker
sudo systemctl enable --now docker   # a reboot must bring the bot back
```

1 GB of RAM is enough for the measured 133 MB, so swap is optional — but an OOM
kill takes the Discord gateway and the scheduler down together and reports it
nowhere, which is the silent failure §1 is about. Cheap insurance:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 7.5 The repo, and the one file that matters

```bash
git clone <repo-url> ~/brandloop && cd ~/brandloop
cp .env.example .env
```

Fill the five REQUIRED values, then these three for a host with two public names:

| Key | Value on this deployment | What it decides |
|---|---|---|
| `PUBLIC_BASE_URL` | `https://api.example.com` | Every generated-image link in a Discord DM |
| `DASHBOARD_BASE_URL` | `https://app.example.com` | The LinkedIn copy-and-open link, and the Google redirect URI both containers build |
| `GOOGLE_REDIRECT_URI` | `https://app.example.com/api/auth/google/callback` | What the API sends to Google; must match the console entry character for character |

Fill in `GOOGLE_CLIENT_ID` at the same time even though the API is what exchanges
the code: the dashboard is what builds the authorize URL, and compose passes the
client ID to that container too. The client *secret* is never passed to it.

Two things that bite. Write `.env` with **LF** endings — a CRLF file smuggles a
`\r` into the value Docker reads (§6). And `NEXT_PUBLIC_DISCORD_INSTALL_URL` in
this file does nothing to a *pulled* image: Next inlines it at build time, so the
button's href is whatever the GitHub Actions variable held when the image was
published (§4). Change it there and republish; the `.env` copy is for local
builds.

Payments stay off until an account number is set, by design: a deployment cannot
offer a checkout it has nowhere to receive.

### 7.6 Start it

```bash
# Only while the GHCR packages are private: a PAT with read:packages.
# echo "$GHCR_PAT" | docker login ghcr.io -u <github-user> --password-stdin
docker compose pull
docker compose up -d --wait
docker compose ps          # both must report healthy
```

`pull` rather than `--build`, and that is the reason the images are published at
all: they are `linux/amd64`, which is what an e2-micro is, and a Next.js
production build wants more memory than this machine has (§4). `--wait` blocks
until the healthchecks pass instead of returning the moment the containers start.

### 7.7 TLS and the reverse proxy

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

Write the two server blocks from §5 into `/etc/nginx/sites-available/brandloop`,
with `listen 80;` where §5 has `listen 443 ssl;` and each `server_name` set to
your own. Symlink it into `sites-enabled`, then let Certbot rewrite it into the
§5 shape and install the renewal timer:

```bash
sudo ln -s /etc/nginx/sites-available/brandloop /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d api.example.com -d app.example.com
```

To avoid opening 80 and 443 at all, run `cloudflared` on the VM instead: it
terminates TLS at Cloudflare and proxies the same two local ports, so it needs no
certificate and no inbound rule beyond SSH.

### 7.8 Verify, in this order

```bash
curl -s https://api.example.com/health
```

The route reports each dependency separately, which is the whole reason it exists:

```json
{
  "status": "ok",
  "uptimeSeconds": 412,
  "dependencies": { "database": true, "discord": true, "scheduler": true },
  "config": { "provider": "gemini", "textModel": "gemini-3.5-flash", "env": "production", "devTools": false }
}
```

`database: false` is §7.2. `discord: false` is a bad token. `scheduler: false` is
the failure §1 exists to warn about: a bot that answers commands and never
generates anything.

```bash
docker compose logs -f api                 # gateway ready, Mongo connected, cron armed
docker compose run --rm api npm run probe  # every credential and model, one command
```

Then the loop, end to end: sign up at `https://app.example.com`, `/connect` in
Discord, create and approve a plan, generate one slot — either wait for 09:00 or
set `NODE_ENV: development` on the `api` service and drive it by hand (§4) —
approve the DM, and open the LinkedIn compose page. **That page is the check that
matters**: its image comes through the dashboard's own route, so it is the one
screen where a missing volume shows up.

**Do not run `npm run seed` on a public host.** The demo password is in the
repository. If you seed for a demo, delete the account afterwards.

### 7.9 Updating, and the two numbers to watch

```bash
cd ~/brandloop && git pull && docker compose pull && docker compose up -d
```

The media volume survives this. A redeploy that loses the images is §6.

- **Egress.** This VM serves every generated image — Discord fetches each one to
  host its own copy, and the compose page streams it again. On a free-tier
  project that is the metered line, so it is the number to watch on the billing
  page.
- **Ports.** `docker compose ps` showing 8080 and 3000 published is correct and
  expected; what must stay true is that the firewall never allows them.
