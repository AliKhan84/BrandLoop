# BrandLoop dashboard

The web app for BrandLoop: sign up, build a content plan, generate and edit
drafts, and link Discord so the approval flow can find you.

## The browser never calls the API

```
Browser ──same-origin──▶ Next.js server ──server-to-server──▶ Express API
```

Every request goes through this app's own server. `lib/api.ts` is the only thing
that talks to the Express API, and it is `server-only` — importing it from a
Client Component is a build error rather than a runtime surprise.

This is forced by a finding, not a preference: the API has **no CORS
middleware**, so a browser call would be blocked before it left. Proxying was
chosen over adding CORS, and three things fall out of it:

- **The session JWT lives in an `httpOnly` cookie** (`lib/session.ts`), never in
  `localStorage`, so an XSS bug cannot exfiltrate a session.
- **CSRF needs no separate token** — the cookie is `sameSite: 'lax'`, so another
  origin cannot drive authenticated requests.
- **The API needed no changes** to serve a browser app.

The cost is one extra network hop per request. The heaviest operation here is
"generate a post", which takes 30–60 seconds, so the hop is unmeasurable.

## Requirements

The API must be running and reachable. Copy `dashboard/.env.example` to
`.env.local` and set:

| Variable | |
|---|---|
| `API_BASE_URL` | Where the Express API is — `http://localhost:8080` in development |
| `NEXT_PUBLIC_DISCORD_INSTALL_URL` | The "Add to Discord" link. Optional: unset simply leaves that button without an href |

`NEXT_PUBLIC_*` values are inlined during `next build`, so this one is
**build-time** configuration — changing it needs a rebuild, not a restart.

## Running it

```bash
npm install
npm run dev          # http://localhost:3000

npx tsc --noEmit     # must be 0 errors
npx eslint .         # must be 0 errors
```

Both checks are expected to be clean; a regression in either is treated as a bug
in this repository rather than a warning to live with.

## Pages

| Route | What it is |
|---|---|
| `/login`, `/signup` | Account creation and sign-in |
| `/workspace` | The main screen: plan rail, per-slot Generate, drafts, and an explanation of the workflow |
| `/drafts` | Every draft and published post, with the editor |
| `/settings` | Profile and the Discord linking panel |
| `/billing` | The plans page — prices in PKR, read from the API that enforces them rather than kept as literals here. Every signup gets a Pro trial and a coupon code can grant Pro or unlimited usage |
| `/billing/pay` | The local checkout: the accounts to send money to, a form taking the transaction reference, and this account's own claim history. The plan activates on submit; the "waiting" states shown are about our bookkeeping, never about the customer's access |
| `/admin/coupons` | Admin only: create codes, see who used them, switch them off. Non-admins get a 404 from the page and a 403 from the API |
| `/admin/payments` | Admin only: reconcile submitted claims — granted ones first, since those are plans already active that nobody has checked against the statement |
| `/compose/[postId]` | The LinkedIn copy-and-open page: copies the text *and the image*, then opens LinkedIn |
| `/api/posts/[postId]/image` | A route handler that proxies image bytes. The browser cannot read the API's `/media` URL — no CORS, and a canvas drawn from it is tainted — so the bytes are fetched server-side and handed over as a same-origin response |

## Auth, and what is not the security boundary

`proxy.ts` (Next 16's renamed middleware) redirects a signed-out visitor away
from a guarded route, and a signed-in one away from the auth pages. It checks
only for the **presence** of a session cookie, because it runs before any server
rendering where the JWT cannot be verified.

**It is not the security boundary.** The real check happens on every server call:
`lib/api.ts` forwards the cookie to the API, an expired or forged token gets a
401, and the workspace layout turns that into a redirect to `/login`. A tampered
cookie gets past `proxy.ts` and is refused by the only component that can
actually tell whether it is valid.

## Theming

The theme is a **cookie the server renders**, not a script: the root layout reads
it and writes `data-theme` into the HTML, `globals.css` resolves the palette
through `light-dark()` against `color-scheme`, and `system` is the *absence* of
the attribute, left to the media query. The page is correct in the first byte,
with or without JavaScript.

**Do not add a `<script>` to the render tree.** React 19 logs an error whenever
it client-renders a script element, and an error recovery re-renders the root
tree — so a hand-written pre-paint script puts that warning on screen on the
first API failure. Every alternative was tried and rejected: `next-themes`,
`next/script`, and a root error boundary. If a rule, a callback or a server
render can do the job, use that instead.

## Docker

The image builds with `output: 'standalone'` (see `next.config.ts`), which is what
keeps it at 380 MB instead of shipping the whole `node_modules` tree, and it runs
as the non-root `node` user.

```bash
docker compose up -d --build      # from the repository root; both services
docker pull ghcr.io/alikhan84/brandloop-dashboard:latest
```

Compose sets `API_BASE_URL=http://api:8080` over the project network, and passes
`NEXT_PUBLIC_DISCORD_INSTALL_URL` as a **build argument** — read from the root
`.env`, since Next inlines it at build time.

## Stack

Next.js 16 (App Router) and React 19, Tailwind CSS v4, Base UI primitives styled
in the shadcn convention, Sonner for toasts, and `next/font` for the type scale.
The brand mark is used as an opaque rounded tile beside a text label rather than
as a bare logo — the PNG has no alpha channel, and its own blue/teal palette is
deliberately kept out of the interface's warm amber tokens.
