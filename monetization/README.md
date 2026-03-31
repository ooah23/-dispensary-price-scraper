# NYCWeedPrice.org — Monetization Playbook

**Goal:** $2,500 MRR by end of month 3.

---

## Phase 1 — Week 1: Plant the Seeds

**Objective:** Make contact with all 17 dispensaries. Get 5 on a free trial.

**Actions:**
- Call every dispensary in `dispensary-tracker.json` — use the 30-second phone script in `outreach-templates.md`
- Send cold email to any you couldn't reach by phone — use the cold email template
- Offer a **free 2-week trial of Featured** with no credit card required — lower the activation energy
- Log every contact in `dispensary-tracker.json` with status, date, and notes
- Send follow-up emails on day 3 for anyone who hasn't responded
- Priority targets for Premium pitch (multi-location operators): Gotham (2 locations), The Alchemy (2 locations)

**Key mindset:** You're not selling — you're telling them their store is already live and offering an upgrade. That's a much warmer conversation.

**Week 1 targets:**
- 17 stores contacted
- 5 on free trial
- 2 verbal "yes, interested" for paid conversion

---

## Phase 2 — Month 1-2: Convert and Build

**Objective:** Convert free trials to paid. Build the analytics dashboard that justifies the monthly fee.

**Actions:**
- Follow up with free trial stores at day 7 and day 14 — share traffic numbers
- Convert at least 3 to Featured ($299/mo) by end of month 1
- Build a simple analytics dashboard (per-store page view counts, click-throughs, time on page)
  - Even a basic weekly email report with Google Analytics data is enough to start
  - This is the main value prop for keeping paying partners — make it tangible
- Explore adding a "Sponsored" badge and banner placement for paying partners on the site
- Begin ad network signup (see Mantis section below)

**Month 1-2 targets:**
- 3 paying partners at $299/mo = $897 MRR
- 1 partner upsold to $699/mo
- Ad network live and serving impressions

---

## Phase 3 — Month 3+: Scale Revenue Streams

**Objective:** Diversify beyond dispensary listings. Hit $2,500 MRR.

**Revenue streams to activate:**

**1. Dispensary upgrades**
- Push paying Featured partners to upgrade to Partner ($699) or Premium ($999)
- Multi-location operators (Gotham, The Alchemy) are natural Premium candidates
- Target: 2x Partner + 1x Premium + 3x Featured = $2,697 MRR from dispensaries alone

**2. Consumer subscriptions**
- "Price Alert" feature: users subscribe to get notified when a specific strain drops below their target price
- Suggested price: $4.99/mo or $39/year
- Requires building a user account system and email/SMS alert infrastructure
- Even 200 subscribers = $998/mo additional MRR

**3. Data licensing**
- The scraped price dataset has value to cannabis industry analysts, investors, and compliance firms
- Package as a monthly CSV export or API access
- Suggested price: $199-$499/mo per subscriber
- Target: 3 data subscribers by month 6

**Month 3 targets:**
- 5 paying dispensary partners (mix of tiers) = ~$1,800 MRR from listings
- Ad network revenue: ~$200-$400/mo
- Consumer subscriptions pilot launched
- Total MRR target: **$2,500**

---

## Ad Network: Mantis

Mantis is the leading ad network for cannabis publishers. It is cannabis-compliant (Google and most mainstream networks refuse cannabis advertisers).

**Signup:** https://www.mantisadnetwork.com/publishers/

**Requirements:**
- Adult-use cannabis content (you qualify)
- Minimum traffic threshold (typically 10,000 pageviews/month — get there first)
- Site must be live and indexed

**Setup steps:**
1. Sign up at the link above as a Publisher
2. Wait for approval (usually 3-7 business days)
3. Place their ad tags in `/public/index.html` or your layout template
4. Recommended placements: above-the-fold banner (728x90), sidebar (300x250), between product rows (native)
5. Revenue share is approximately 70% to publisher — expect $2-$8 CPM depending on traffic quality

**Other networks to consider (in order of priority):**
- **Leafly Ads** — if you build enough traffic, Leafly has a self-serve ad platform for dispensaries
- **Traffic Roots** — cannabis-friendly programmatic network, good fill rates
- **AdThrive / Mediavine** — not cannabis-compliant but worth applying once you hit 50k+ monthly sessions if you diversify content

---

## Key Metric Dashboard

| Metric | Day 30 Target | Day 60 Target | Month 3 Target |
|---|---|---|---|
| Paying partners | 1 | 5 | 7 |
| MRR (listings) | $299 | $1,495 | $1,800 |
| MRR (ads) | $0 | $100 | $300 |
| MRR (subscriptions) | $0 | $0 | $400 |
| **Total MRR** | **$299** | **$1,595** | **$2,500** |
| Monthly site visitors | 1,000 | 5,000 | 15,000 |

---

## Files in This Directory

| File | Purpose |
|---|---|
| `outreach-templates.md` | Email, phone, and pricing templates for dispensary outreach |
| `dispensary-tracker.json` | CRM — log every outreach contact and status here |
| `revenue-tracker.json` | Track MRR, partners, and ad network revenue |
| `README.md` | This playbook |
