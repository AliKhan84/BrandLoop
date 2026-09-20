# BrandLoop — slide generation prompt

Paste this whole file into ChatGPT. It contains the deck's content, the facts
that may be used, the design system, and the logo rules.

---

ROLE
You are a senior presentation designer and technical writer. You are building a
slide deck for a university course presentation.

TASK
Produce a complete 8-slide deck from the content below, then a short asset
checklist. The content is final — use it as written. You may tighten wording to
fit a slide, but never add, remove, or change a fact, number, or feature.

CONTEXT
- Product: BrandLoop — an AI-powered personal branding assistant that turns a
  person's expertise into a consistent presence on X and LinkedIn.
- How it works in one line: an agentic pipeline that plans, writes and
  illustrates posts, with a human approving every one before it is published.
- Presenter: Ali Khan, Course: Applied AI & ML.
- Audience: course instructor and peers. They want technical depth and honest
  engineering judgement, not marketing.
- Length: 8 slides, roughly 8-10 minutes of talking.
- A live product demo happens immediately BEFORE the final slide, so the last
  slide thanks the audience and invites questions.

NON-NEGOTIABLE RULES
- Use only the facts supplied here. Do not invent metrics, users, benchmarks,
  quotes, or features. If something is not stated below, it does not exist.
- No hype words ("revolutionary", "game-changing", "seamless", "cutting-edge").
- No emoji anywhere. No exclamation marks.
- Bullets are short: maximum 6 per slide, roughly 10-14 words each. Never a
  paragraph on a slide.
- Write in sentence case, not Title Case, except for slide titles.

===============================================================
DESIGN SYSTEM — apply to every slide
===============================================================

PALETTE (the application's own design tokens — use these, do not invent a theme)
- Slide background:   #FCFAF6  (warm paper)
- Primary text:       #1E1A14  (warm near-black ink)
- Accent (sparingly): #EA8A18  (amber) — for rules, numbers, small emphasis only
- Panel / muted fill: #F4F1ED
- Borders:            #E0DED8
- Secondary text:     #6B665E
- Do NOT use the logo's blue and teal as deck accents. The application's
  interface is deliberately warm amber-on-paper, and the screenshots on the
  slides are all in that palette. Mixing the two reads as two brands.

TYPOGRAPHY
- One sans-serif family for everything (Geist, Inter, or Helvetica Neue).
  Optional: a serif for the deck title slide only.
- Slide title 40-44pt semi-bold. Subtitle 20-22pt regular. Bullets 18-20pt,
  line spacing 1.3. Never below 16pt.
- No text over screenshots, no text over patterns.

LAYOUT
- One idea per slide. Generous white space; margins at least 8% of the slide.
- Left-align text. Consistent title position and size across all slides.
- No drop shadows, gradients, glass effects, stock photography, or clip art.
- If a slide needs a diagram, use the design tokens above and keep it to simple
  boxes and arrows.

LOGO RULES (important — the file has specific properties)
- File: BrandLoop-logo.png (1254x1254). It contains a blue and teal interlocking
  loop mark with the wordmark "BrandLoop" underneath.
- It has NO transparency and a solid white background, and the artwork only fills
  the middle ~63% of the file. So: trim the white padding before placing it, and
  place it inside a white rounded card (corner radius ~16px) whenever the slide
  background is not white. Never place the raw file directly on a dark surface.
- Minimum width 150px. Below that the wordmark is illegible.
- Do not recolour, outline, or distort the logo. Do not add a second "BrandLoop"
  wordmark next to it — the name is already inside the image.
- Place the logo: large on the title slide, small in a corner on the closing
  slide. Keep it off the content slides.

SCREENSHOTS
- Capture in the application's LIGHT theme, because the deck background is the
  same warm paper tone.
- Place screenshots on the right half of a slide, with a 1px #E0DED8 border and
  a small caption underneath in #6B665E.
- Crop to the content — no browser chrome, no desktop background.
- The Discord approval message is the hero image of this deck: it is the moment
  the product's promise becomes visible.

===============================================================
SLIDE CONTENT — use as written
===============================================================

SLIDE 1 — Title
Title: BrandLoop
Subtitle: Your expertise, published consistently.
Line: AI-powered personal branding assistant for X and LinkedIn
Line: Ali Khan | Applied AI & ML
Line: An agentic pipeline with a human in the loop: it plans, writes and
illustrates, you approve
Line: Live demo at the end
Layout: centred, wide margins, logo trimmed and large above the title.

SLIDE 2 — The problem
Title: Personal branding is no longer optional
Subtitle: Distribution decides who gets found
Bullets:
- Clients, recruiters and opportunities search for expertise. Without a visible
  presence you are not in the results
- Consistency compounds: audiences and algorithms both reward showing up
  repeatedly
- But posting consistently is a second job: research, a blank page, formatting
  per platform, timing
- Most people quit in week two, so the compounding never starts
- Existing tools generate volume. They do not build trust: no expertise, no
  opinions, no accountability
Speaker note: the real gap is not "write my posts" — it is "keep me consistent
without losing my voice".

SLIDE 3 — How it works
Title: One loop, eight steps
Subtitle: You approve. It does everything else.
Bullets (numbered):
1. Sign up with your niche, your opinions, posting frequency, platforms and
   timezone
2. AI builds a 7- or 30-day content plan: a theme per slot, one news-based post
   per week
3. Every day at 09:00 the scheduler drafts a post for X and LinkedIn. No app to
   open
4. An image is generated for the post
5. The draft arrives in Discord with Approve, Reject and Edit
6. Edit in Discord or in the dashboard — one shared service, two entry points
7. Publish in one click: a pre-filled composer link on X, a copy-and-open page
   for LinkedIn
8. Every call's cost and quota is logged
Layout: vertical numbered list on the left, one screenshot of the Discord
approval message on the right.

SLIDE 4 — Under the hood
Title: The AI pipeline
Bullets:
- Text generation: one structured call per post. The prompt carries the niche,
  the user's own opinions, the slot theme and the platform constraints; the
  response is parsed as JSON (hook, body, hashtags, art direction)
- Two providers behind one interface: Gemini 3.5 Flash and OpenAI GPT-5.1.
  Switching is one environment variable. A cheaper model handles the
  high-volume calls
- Grounded news, not invented news: news posts come from Google News RSS, so
  every cited URL is real. A hallucinated citation is structurally impossible
- Images: gpt-image-1. The prompt is the model's own art direction plus the
  user's niche plus a fixed style suffix
- Guardrails: hard platform limits of 280 and 3000 characters, truncated on a
  sentence boundary; a failed platform is retried alone, never the whole post
- Cost control: quotas are consumed before every paid call, so a failure never
  still bills
- No LangChain: official SDKs plus hand-written prompt modules, chosen for exact
  control of the JSON contract and predictable cost
Layout: two columns to fit seven bullets, or six bullets plus a small pipeline
diagram. Keep it readable; if it feels dense, put the "No LangChain" line in the
speaker notes instead.
Speaker note: if asked why not a framework — a strict output contract and
per-call cost accounting mattered more than orchestration.

SLIDE 5 — Frontend stack
Title: Tech stack: frontend
Bullets:
- Next.js 16.3.5 with the App Router and Turbopack, React 19.2, TypeScript 5
- Tailwind CSS v4, shadcn/ui and Base UI primitives, lucide-react icons,
  sonner toasts
- Server-first: the dashboard is a backend-for-frontend, so the browser never
  calls the API directly
- Flicker-free theming: the theme is a cookie the server renders, and the
  palette resolves in CSS, so it is correct in the first byte with no script
- Screens: workspace, drafts, settings, billing plans, LinkedIn copy-and-open
  page
- tsc --noEmit and ESLint 9 clean
Layout: bullets left, dashboard screenshot right.

SLIDE 6 — Backend stack
Title: Tech stack: backend, data and integrations
Bullets:
- Node.js 20+ and Express 5 in ESM, MongoDB Atlas with Mongoose 9
- Auth: bcrypt password hashing, JWT in an httpOnly cookie, per-router guards
- AI: the OpenAI and Google GenAI SDKs behind one provider interface. Zod
  validates the environment on boot and every request body
- Discord: a discord.js v14 bot with /connect, /status, /plan and
  Approve, Reject, Edit buttons
- Scheduling: a daily node-cron job; news from Google News RSS parsed with
  fast-xml-parser
- Ops: structured logger with secret redaction, graceful shutdown, health
  endpoint, and an error taxonomy of 503 for an outage, 401 for a dead session,
  500 only for a real defect
- 150 automated tests with the built-in node:test runner
Layout: two columns if needed; keep the error taxonomy as one bullet.

SLIDE 7 — Remaining work
Title: Remaining work
Subtitle: What is deliberately not built yet
Bullets:
- Payments: the plans page exists (Free, Creator $5, Pro $10) but is UI only.
  No checkout, no plan stored on the account, and the API still enforces
  free-tier quotas for everyone
- Next for payments: a payment provider, a plan field on the user, and quotas
  read from the plan
- Short video: model-generated clips to accompany posts
- LinkedIn Community Management API: would replace the copy-and-open page with
  true publishing
- Quality and scale: an evaluation harness for generated posts, a learning loop
  from user edits, multi-user hardening
- Stated honestly: the free tier allows 20 requests per day per model, so a
  30-day plan needs a paid key or model rotation
Layout: optional simple three-card row for Free, Creator, Pro above the bullets.
Speaker note: the plans page shows real free-tier limits so it cannot advertise
a ceiling the product does not honour.

SLIDE 8 — Closing
Title: Thank you
Line: Questions?
Line (small): Live demo before this slide: the workspace and a generated plan,
one post generated live, the Discord approval, and the composer link with the
image copied to the clipboard.
Layout: centred, minimal, logo small in the corner inside a white rounded card.

===============================================================
OUTPUT FORMAT
===============================================================
Produce, in this order:

1. The deck, slide by slide, each in exactly this template:
   SLIDE <n> — <title>
   Subtitle: <text or "none">
   Bullets: <the bullets, no more than 6>
   Speaker note: <2-3 sentences, coach the presenter, not the audience>
   Layout: <one line: where the text, image and logo sit>
   Assets: <the images this slide needs>

2. An asset checklist: every screenshot and image the deck needs, with a
   one-line description of what must be visible in each.

3. A one-paragraph design summary stating the background colour, text colour,
   accent colour, font, and the logo rule, so a slide generator can be
   configured from it.

Keep the total output under 900 words. Do not add extra slides, sections, or
commentary beyond these three items.
