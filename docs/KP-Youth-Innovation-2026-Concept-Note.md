# BrandLoop — AI Content Operations for Khyber Pakhtunkhwa's Freelancers and Small Businesses

**Khyber Pakhtunkhwa Youth Innovation & Entrepreneurship Competition 2026**
Business Idea Concept Note · Submitted to ORIC, University of Technology Nowshera

**Theme alignment:** *Innovative Ideas for an Inclusive, Resilient and Prosperous Khyber Pakhtunkhwa*
**Categories:** Digital Innovation & Artificial Intelligence (primary) · Women & Youth Entrepreneurship · Skills and Future of Work · E-Commerce and Market Access

---

## 1. Project title and team

**Title:** BrandLoop — AI content operations with human approval and local payment, built for Khyber Pakhtunkhwa.

**Team:**

| # | Name | Roll No. | Department / Program | Email | Phone |
|---|---|---|---|---|---|
| 1 | Ali Khan *(team lead)* | _[fill in]_ | _[fill in]_ | _[fill in]_ | _[fill in]_ |
| 2 | _[fill in]_ | _[fill in]_ | _[fill in]_ | _[fill in]_ | _[fill in]_ |
| 3 | _[fill in]_ | _[fill in]_ | _[fill in]_ | _[fill in]_ | _[fill in]_ |
| 4 | _[fill in]_ | _[fill in]_ | _[fill in]_ | _[fill in]_ | _[fill in]_ |

*(Interdisciplinary teams are encouraged — a mix of computing, business and social-science students would strengthen the commercial and impact work in the pilot.)*

---

## 2. Problem being addressed

In Khyber Pakhtunkhwa, thousands of skilled young people compete for online work — freelancing, remote jobs, consulting — and thousands of small, often home-based businesses sell good products. Almost all of them lose customers for the same avoidable reason: **they are invisible online, or visible but inconsistent.**

The barriers are specific and they compound:

- **Content production is a skilled, daily job.** A credible profile needs several posts a week, written well, with images, in a consistent voice. A shopkeeper selling Swati honey or a developer looking for international clients does not have the hours or the English-language writing practice.
- **A social media manager is unaffordable.** Hiring one costs Rs 25,000–60,000 a month — more than the monthly profit of most micro-businesses this tool is for.
- **Global AI tools are priced and paid for in dollars.** They need a credit card. Most people in KP who would benefit do not have one, and even where a card exists, foreign exchange and card-use restrictions make a $20/month subscription a genuine obstacle. The affordability problem is not the price — it is the **payments rail**.
- **Generic AI output is generic.** Existing tools ask the user to write the brief. A shopkeeper does not know what to ask, so the output does not sound like them, and they stop using it after a week.
- **Home-based women entrepreneurs are the least served and stand to gain the most**, because a business they can market from a phone at home avoids the mobility constraints that make a physical shopfront hard.

The result is a digital divide inside the province: the people with the most to gain from going online are the least able to produce what going online requires.

---

## 3. Proposed product or service

**BrandLoop is a subscription web service that runs a small business's or a freelancer's social presence as an approvals workflow: the AI drafts, the owner approves, the tool prepares the post for publishing.**

**The product is built and working today** — not a mock-up. It was developed as a student project and runs end to end: a server (API), a dashboard, a delivery bot, and a local payment flow. What it does:

1. **Onboarding.** The user states their niche, their platforms, and — critically — **their own opinions**, in their own words.
2. **A content plan.** BrandLoop generates a 7-day or 30-day plan with a specific angle for each slot, mixing planned posts with one news-linked post a week.
3. **Research that cannot be faked.** News posts are sourced from a real news feed, and the post carries the real article link. The system is structurally unable to invent a citation — a small design decision with a large credibility consequence.
4. **Drafts that fit the platform.** Separate posts for X (280-character limit, or a numbered thread when the idea needs more) and LinkedIn (up to 3,000 characters), with hard character enforcement and a length-fitting pass, plus **one generated image per post** in a consistent brand style.
5. **Approval by the owner, every time.** Each draft is delivered as a message with **Approve / Reject / Edit**. Nothing is published without the owner. Because BrandLoop never needs the user's social media password, it also never creates the account-takeover and terms-of-service risks that fully automated posting tools do.
6. **One-click publishing assistance.** For X, the tool produces a composer link with the post already filled in. For LinkedIn, where pre-filling is not technically possible, it opens a copy page that copies the text *and the image* so the owner pastes and posts.
7. **Fair-use quotas and predictable costs.** Every tier has metered allowances (posts, news research, images) so a heavy user cannot make the service unprofitable and a light user is never surprised.
8. **Payment in rupees, the way KP actually pays.** Bank transfer or Raast, JazzCash or Easypaisa — with the plan activating the moment the customer submits their transaction reference, and the operator reconciling it against their own statement afterwards. **A competitor asking for a credit card cannot serve this market; this is the single most important localisation in the product.**

---

## 4. Innovation and uniqueness

| What is different | Why it matters commercially |
|---|---|
| **Human approval is the design, not a limitation** | Misinformation and embarrassing AI posts are the reason small businesses distrust AI marketing. A draft that a human must approve is a *feature the customer can trust*, and it keeps the business off the wrong side of platform rules |
| **Local payment rails (Raast, JazzCash, Easypaisa) with instant activation** | Removes the real barrier for the target market — not price, but the card. Global competitors cannot easily match this because a Pakistani gateway needs a merchant account, which BrandLoop handles by design |
| **Personalisation by selection, not by prompt length** | The owner's opinions steer **which** material is chosen and how it is framed, rather than being dumped into a keyword query. A documented engineering finding in the project: adding opinion sentences to a news query returns *zero* usable results, while the niche alone returns a full set — so the intelligence is in the selection step |
| **No stored social credentials, no automation of someone else's account** | The user's accounts cannot be compromised by a breach of ours, and the tool cannot be used in a way that gets the customer banned |
| **Cost engineering that makes a Rs 1,500 plan possible** | Measured image cost is about **$0.04 per image** (~Rs 11) and about 17 seconds each; per-post cost is a few rupees. A designer would charge hundreds. This is what allows a locally affordable price with a healthy margin |
| **Honest, documented status** | The build, its cost measurements, its failure modes and its limitations are all written down. For a judge or an investor, a team that knows exactly what its product does not do yet is a lower-risk team |

**Why now.** Three things changed in the last two years: AI generation became cheap enough that a Rs 1,500/month retail price still leaves a healthy margin; **Raast** made instant, fee-free person-to-person transfers normal; and KP's own skills and freelancing programmes have produced a large population of digitally capable youth who need a professional online presence but have no affordable way to produce one.

---

## 5. Target users or customers

**Beachhead segment (paying customers from month one): KP's freelancers, developers, and young professionals selling to clients outside the province.** They already work online, they understand the value of a LinkedIn/X presence for winning clients, they use chat tools daily, and Rs 1,500–3,000 a month is justifiable against the income one extra client brings. This is where the product's current platform support (X and LinkedIn) fits exactly.

**Second segment (months 4–12, the inclusion story): small and home-based businesses — handicrafts, tailoring and boutiques, food, local services — and women-led enterprises run from home.** Their customers are on Facebook, Instagram and WhatsApp, and they write in Urdu and Pashto. This segment needs two additions the roadmap already names: those platforms, and approval over WhatsApp instead of the current channel, because WhatsApp is what this segment already uses every day.

**Third segment (channel, not just customers): local marketing freelancers and small agencies** who manage several clients and will pay for a multi-client workspace. Each such customer brings 3–10 businesses with them — a low-cost distribution route that also creates skilled local jobs.

**Estimates to validate in the pilot:** _[state the number of KP freelancers / small enterprises you are sizing against, with the source — SMEDA, KPITB or the KP Bureau of Statistics — before submission.]_

---

## 6. Business or revenue model

A freemium subscription with a generous trial, priced in rupees, billed monthly or annually.

| Tier | Price | What it includes (per day / week) |
|---|---|---|
| **Free** | Rs 0 | 3 plan generations/day, 2 news lookups/day, 5 images/week — enough to prove the product |
| **Creator** | **Rs 1,500 / month** | 15 plan generations/day, 10 news lookups/day, 30 images/week |
| **Pro** | **Rs 3,000 / month** | 40 plan generations/day, 20 news lookups/day, 100 images/week |
| **Annual** | 2 months free (roadmap) | Same allowances, paid yearly — improves cash flow and reduces reconciliation work |
| **Agency / multi-client** | Rs 6,000+ / month (roadmap) | Several client workspaces under one account |

Every new signup receives **30 days of Pro free**, so the customer experiences the full product before paying. Payment is by bank transfer/Raast, JazzCash or Easypaisa; the plan activates immediately and the operator reconciles the transfer afterwards.

**Unit economics (one paying Pro user, per month):**

| Line | Amount |
|---|---|
| Revenue | Rs 3,000 |
| AI cost — 20 image posts (~$0.04 each) + text generation | ≈ Rs 260–350 |
| Hosting, domain, email (shared across users) | ≈ Rs 50–100 |
| Payment operations (manual reconciliation, minutes per claim) | ≈ Rs 30–50 |
| **Contribution margin** | **≈ Rs 2,550–2,650 (~85%)** |

**Break-even.** Run by the founders, the monthly fixed cost is roughly Rs 5,000 (small server, domain and email, development tooling) — about **two subscribers**. With one salaried operations hire at Rs 40,000/month, break-even is about **17 Pro subscribers**. The pilot target of 50 paying users therefore supports the founders plus one or two paid roles, and the model improves further as annual and agency plans raise average revenue per user.

---

## 7. Estimated cost and use of funds

**One-time (pilot setup):**

| Item | Cost (PKR) |
|---|---|
| Domain, email and brand basics | 8,000 |
| Business registration / NTN (required before any payment gateway can be applied for) | 15,000 |
| Pilot outreach — campus, chambers, two districts (printed material, small social campaigns) | 25,000 |
| Contingency | 7,000 |
| **Total one-time** | **55,000** |

**Recurring (monthly, rising with usage):**

| Item | Cost (PKR) |
|---|---|
| Server with persistent storage (the scheduler and the delivery bot need an always-on host — free tiers that sleep cannot run this) | 3,000 |
| AI generation — 50 paying users | 15,000 |
| Tools, monitoring, minor services | 1,500 |
| **Total monthly** | **≈ 19,500** |

**12-month pilot budget: ≈ Rs 2,89,000 (about Rs 2.9 lakh).** This funds a full year to 50 paying users — including the first salaried hire from month four — and is deliberately modest: the product is already built, so the money buys customers, not code.

**If the full prize is awarded, the additional funds unlock, in order of impact:**
1. **Merchant account and payment-gateway integration** (Rs 1.5–3 lakh in fees, documentation and integration) — removes manual reconciliation entirely and lets renewal be automatic.
2. **WhatsApp-based approval** (Rs 2–3 lakh) — the single biggest unlock for the small-business and women-entrepreneur segment.
3. **Urdu and Pashto content generation** (Rs 1–2 lakh) — required to serve local-audience businesses rather than only English-language professional profiles.
4. **Two additional hires and a published impact study** (Rs 3–4 lakh) — measured income effects for pilot users, with the university.

---

## 8. Employment and social impact

**Direct employment.** One operations and customer-support role per ~40 paying subscribers (reconciling payments, quality-checking generated content, onboarding). The 12-month pilot creates the founders' full-time work plus one salaried position; the prize-scale plan creates two more. These are digital-economy jobs that do not require a graduate degree, only training — and the role is created inside KP rather than outsourced.

**Income for freelancers and youth (the core impact thesis).** A subscriber who wins one additional small client in a year gains far more than the subscription costs; the tool pays for itself at roughly a tenth of one project's value. **This is the claim the pilot must measure, not assume** — the intention is to publish the measured effect (income uplift, clients won, time saved) with the university at the end of the pilot.

**Women's economic participation.** Home-based and women-led businesses can be marketed entirely from a phone, with no mobility requirement, no male family member needed to handle a bank counter or a card transaction, and income received directly in the owner's name through JazzCash or Easypaisa. Pairing with the **Women Chamber of Commerce and Industry** and university women's societies is the intended route to this segment.

**Financial inclusion.** By accepting the payment methods the province actually uses rather than only cards, BrandLoop brings customers into formal digital commerce who are otherwise excluded from online subscriptions altogether.

**Skills and the future of work.** The approval workflow is itself a training surface: users learn what a good post looks like, why a hook works, and how to review AI output critically. That is the skill most needed in an economy where AI writes the first draft of everything.

**Provincial prosperity.** Freelancers billing international clients bring foreign exchange into KP. Every subscriber who lands one more foreign client is a small export win, and the service revenue itself stays in the province.

---

## 9. Implementation plan

**What is already done (before this competition):**
- A working product: accounts and sign-in, content planning, news research, post and image generation, approval workflow, publishing assistance, quotas, a daily scheduler, an operations dashboard, and a local payment and reconciliation flow.
- Engineering discipline that reduces delivery risk: 298 automated tests, type-checked and lint-clean dashboard, containerised deployment, and a written record of the product's design decisions, cost measurements and known limitations.

**Months 1–3 — Pilot (target: 15 paying users, first revenue).**
Recruit from the university's own networks, freelancer communities and one chamber; onboard each user personally and record content quality and time saved; publish weekly before/after content samples; measure willingness to pay and churn.
*Milestone: Rs 30,000+ monthly recurring revenue; documented content-quality evidence.*

**Months 4–6 — Product-market fit for the second segment.**
Facebook, Instagram and WhatsApp support with Urdu content; WhatsApp approval channel; annual plan; apply for the merchant account.
*Milestone: 40 paying users; first salaried operations hire; average revenue per user above Rs 1,800.*

**Months 7–12 — Scale and prove impact.**
Multi-client agency workspace; two-district outreach with chamber partners; a measured impact study with ORIC; a paid conversion funnel replacing personal onboarding.
*Milestone: 100+ paying users, ~Rs 2 lakh monthly revenue, three paid roles, and a published impact result.*

**Risks and how they are controlled**

| Risk | Control already in place or planned |
|---|---|
| AI cost or model price changes | Provider-independent design (two AI providers implemented), strict per-tier quotas, cheap model for drafting and a premium one only for images |
| Platform rules or APIs change | No automation of customer accounts and no stored credentials, so a platform change cannot break a customer's account or block a customer's ability to post manually |
| Customers cannot pay or renew | Local rails from day one; manual reconciliation means payment never depends on a gateway outage; gateway is an optimisation, not a dependency |
| Fraud in manual payments | Grant-then-reconcile is bounded by design: the free trial already gives a fraudster the same value, only one claim can be open per account, every granted day is reversible in one tap, and each grant records exactly what it replaced so a reversal never costs an honest customer anything |
| Concentration on one delivery channel | Approval moves to WhatsApp in months 4–6, which is the channel the second segment already uses |

---

## 10. Declaration of originality

We declare that this concept note and the software it describes are our own original work, produced by the team named above, and that the idea has not been copied from any other source. Third-party open-source libraries used in the product are publicly licensed and acknowledged in the project's documentation. AI coding assistants were used as development tools, in the same way a compiler or a design tool would be; the product design, decisions and the work presented here are the team's own. Where the concept note uses estimates or figures to be validated, they are labelled as such — we have deliberately not presented projections as facts.

| Name | Signature | Date |
|---|---|---|
| _[fill in]_ | | |
| _[fill in]_ | | |
| _[fill in]_ | | |
| _[fill in]_ | | |

---

### Notes for the team before submission (delete this page)

- **Fill in:** team names, roll numbers, departments, emails and phone numbers; the university/college details and the lead's signature block; the estimated freelancer/enterprise market size in §5 with a citable source (SMEDA, KPITB, KP Bureau of Statistics, or a chamber's own count).
- **State the exchange rate** you used for the USD→PKR cost conversions (the figures above assume roughly Rs 280/USD; update if it moves before 30 September 2026).
- **The honest status is the pitch.** The strongest sentence in this note is that the product already works. In the Q&A, say plainly what is not built yet (Facebook/Instagram, Urdu, automatic payment verification) and why — a team that knows its gaps is a lower-risk bet than one that claims everything.
- **For the 15-minute presentation:** show the actual product — submit a payment claim, watch the plan activate, open a generated draft in Discord and approve it, then show the pre-filled X composer. A live demo of a working system beats any slide deck.
- **Two copies required:** hard copy to the ORIC office and email to oric@uotnowshera.edu.pk, well before **30 September 2026**.
