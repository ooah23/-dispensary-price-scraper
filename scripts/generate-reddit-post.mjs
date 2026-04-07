/**
 * scripts/generate-reddit-post.mjs
 *
 * Reads today's scrape output, computes price stats, and generates a
 * ready-to-post Reddit draft with real data filled in.
 *
 * Outputs:
 *   - output/reddit-draft.txt  (title + body + pre-filled Reddit URL)
 *   - Console summary
 *
 * Date-aware: picks the right subreddit + angle based on proximity to 4/20.
 * After 4/20 switches to a weekly Monday cadence.
 *
 * Called from scripts/auto-scrape.bat after a successful scrape.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT        = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR  = path.join(ROOT, "output");
const TODAY_JSON  = path.join(OUTPUT_DIR, "dispensary-prices.json");
const HISTORY_DIR = path.join(OUTPUT_DIR, "history");
const DRAFT_FILE  = path.join(OUTPUT_DIR, "reddit-draft.txt");

// ─── Helpers ────────────────────────────────────────────────────────────────

// Allow --date YYYY-MM-DD override for testing
const dateArg = (() => {
  const i = process.argv.indexOf("--date");
  return i !== -1 ? process.argv[i + 1] : null;
})();
const NOW = dateArg ? new Date(dateArg) : new Date();

function dateStamp(d = NOW) {
  return d.toISOString().slice(0, 10);
}

function yesterdayStamp() {
  const d = new Date(NOW);
  d.setDate(d.getDate() - 1);
  return dateStamp(d);
}

async function readJson(p) {
  try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return null; }
}

// Days until 4/20 from today
function daysUntil420() {
  const target = new Date(NOW.getFullYear(), 3, 20);
  if (NOW > target) target.setFullYear(target.getFullYear() + 1);
  return Math.ceil((target - NOW) / 86400000);
}

// ─── Stats ───────────────────────────────────────────────────────────────────

function computeStats(stores) {
  const eighths = [];
  const ounces  = [];

  for (const s of stores) {
    if (s.status !== "ok") continue;
    for (const l of (s.eighthOunceListings || [])) {
      if (!l.preGround && l.price > 0) eighths.push({ price: l.price, store: s.name, neighborhood: s.neighborhood });
    }
    for (const l of (s.ounceListings || [])) {
      if (!l.preGround && l.price > 0) ounces.push({ price: l.price, store: s.name, neighborhood: s.neighborhood });
    }
  }

  eighths.sort((a, b) => a.price - b.price);
  ounces.sort((a, b) => a.price - b.price);

  const okStores = stores.filter(s => s.status === "ok").length;
  const cheapestEighth  = eighths[0]  ?? null;
  const expensiveEighth = eighths.at(-1) ?? null;
  const cheapestOunce   = ounces[0]   ?? null;

  const spread = (cheapestEighth && expensiveEighth)
    ? expensiveEighth.price - cheapestEighth.price : 0;

  const avgEighth = eighths.length
    ? Math.round(eighths.reduce((s, e) => s + e.price, 0) / eighths.length)
    : null;

  const perGramCheapest = cheapestOunce
    ? (cheapestOunce.price / 28).toFixed(2) : null;

  return { okStores, cheapestEighth, expensiveEighth, cheapestOunce, spread, avgEighth, perGramCheapest, eighthCount: eighths.length };
}

// ─── Price drops vs yesterday ─────────────────────────────────────────────

async function getDrops(stores) {
  const yData = await readJson(path.join(HISTORY_DIR, `${yesterdayStamp()}.json`));
  if (!yData) return [];
  const yMap = new Map(yData.map(s => [s.name, s]));
  const drops = [];
  for (const s of stores) {
    if (s.status !== "ok") continue;
    const y = yMap.get(s.name);
    if (!y || y.status !== "ok") continue;
    const todayPrice = s.cheapestEighthOunce?.price;
    const yestPrice  = y.cheapestEighthOunce?.price;
    if (!todayPrice || !yestPrice || yestPrice <= 0) continue;
    const pct = (yestPrice - todayPrice) / yestPrice;
    if (pct >= 0.10) drops.push({ store: s.name, neighborhood: s.neighborhood, oldPrice: yestPrice, newPrice: todayPrice, pct: Math.round(pct * 100) });
  }
  drops.sort((a, b) => b.pct - a.pct);
  return drops;
}

// ─── Post generators ──────────────────────────────────────────────────────

function postPriceSpread(stats, drops, daysTo420) {
  const sub   = "NYCcannabis";
  const spread = stats.spread;
  const title = `Checked prices at all ${stats.okStores} legal NYC dispensaries today — cheapest eighth is $${stats.cheapestEighth.price}, most expensive is $${stats.expensiveEighth.price}`;

  const dropLines = drops.length
    ? `\nSome notable moves since yesterday:\n${drops.slice(0, 3).map(d => `- ${d.store} (${d.neighborhood}): $${d.oldPrice} → $${d.newPrice} on eighths (${d.pct}% drop)`).join("\n")}\n`
    : "";

  const countdownLine = daysTo420 <= 17
    ? `\n${daysTo420} days out from 4/20 — worth knowing which spots are actually running deals vs which ones are just calling normal prices "special."\n`
    : "";

  const body = `Been automating the daily menu scrape across all licensed NYC dispensaries. Here's where things stand today.

The spread on a single eighth: $${stats.cheapestEighth.price} (${stats.cheapestEighth.neighborhood}) up to $${stats.expensiveEighth.price} — that's a $${spread} gap for the same weight class, same legal product, same city.

Average eighth across all ${stats.okStores} stores: ~$${stats.avgEighth}

Some patterns I keep noticing:
- Price drops happen quietly, no announcements — menus just update
- Stores with less foot traffic / lower-overhead locations consistently run cheaper
- Ounce pricing is where the real spread shows up in dollar terms
- A handful of spots are reliably 15–20% below the median${dropLines}${countdownLine}
Happy to answer questions about specific stores or neighborhoods.`;

  return { sub, title, body };
}

function postPerGram(stats, daysTo420) {
  const sub   = "FuckCombustion";
  const title = `Price-per-gram across all ${stats.okStores} legal NYC dispensaries today — ran the math`;

  const countdownLine = daysTo420 <= 17
    ? `\nWith 4/20 coming up in ${daysTo420} days, worth knowing your actual per-gram cost before you stock up.\n`
    : "";

  const body = `FC crowd cares about efficiency so figured this was worth sharing. Pulling daily menu data from all ${stats.okStores} licensed NYC dispensaries and ran the per-gram breakdown.

The math (ounce price ÷ 28g = cost per gram):

| Tier | Price | Per gram |
|---|---|---|
| Cheapest ounce in the city right now | $${stats.cheapestOunce.price}/oz | $${stats.perGramCheapest}/g |
| Cheapest eighth | $${stats.cheapestEighth.price}/8th | $${(stats.cheapestEighth.price / 3.5).toFixed(2)}/g |
| Average eighth | ~$${stats.avgEighth}/8th | ~$${(stats.avgEighth / 3.5).toFixed(2)}/g |
| Most expensive eighth | $${stats.expensiveEighth.price}/8th | $${(stats.expensiveEighth.price / 3.5).toFixed(2)}/g |

Why this matters for vaporizer users: if you're extracting efficiently, the per-gram cost is your real unit of value — not the label or the display case. A $${stats.cheapestOunce.price} ounce at $${stats.perGramCheapest}/g vaped well beats a $${stats.expensiveEighth.price} eighth of "top shelf" at $${(stats.expensiveEighth.price / 3.5).toFixed(2)}/g any day.${countdownLine}
Some patterns I keep seeing:
- The cheapest per-gram ounces are not at the name-recognition shops
- A few stores have zero bulk discount — ounce is literally 4x the eighth price
- Drops happen without announcement, worth checking before you buy
- Lower overhead location = consistently lower price, regardless of strain quality

Happy to share specific numbers on any store or neighborhood.`;

  return { sub, title, body };
}

function postTrees(stats, daysTo420) {
  const sub   = "trees";
  const title = `NYC has ${stats.okStores} legal dispensaries now and the price difference between them is wild`;

  const countdownLine = daysTo420 <= 17
    ? `\n4/20 is ${daysTo420} days out — if you're in NYC it's worth checking a few menus before committing to wherever's closest.\n`
    : "";

  const body = `Started tracking prices across all the licensed spots in NYC (there are ${stats.okStores} now, which still seems surreal for a city that spent decades as the weed arrest capital of the country).

The spread on a single eighth can be $${stats.spread} depending on where you walk in. Today: $${stats.cheapestEighth.price} at the cheapest, $${stats.expensiveEighth.price} at the most expensive. Same weight class, same legal product, same city.

Some random observations from watching this daily:
- There's no consistent logic to which stores are cheaper — not neighborhood, not store size, not how fancy the spot looks
- A few stores seem to do dynamic-ish pricing — same strain $5 cheaper on a Tuesday than Friday
- Ounce buyers get the most inconsistent treatment: some stores have real bulk discounts, some are just 4x the eighth price
- The "deals" sections on some menus are genuinely good; others are just regular priced stuff with a banner on it${countdownLine}
The economics of this transitional market are genuinely interesting to watch. Anyone else paying attention to which spots are actually worth it vs which are trading on location/vibe?`;

  return { sub, title, body };
}

function postDealsVsMarketing(stats, drops) {
  const sub   = "NYCcannabis";
  const title = `Which NYC dispensaries actually have 4/20 deals vs which ones are just calling regular prices a deal`;

  const dropLines = drops.length
    ? `\nActual price drops I've tracked in the last few days:\n${drops.slice(0, 4).map(d => `- ${d.store}: $${d.oldPrice} → $${d.newPrice} on eighths (${d.pct}% drop)`).join("\n")}\n`
    : "\nNo significant price drops in the last day — stores haven't moved yet.\n";

  const body = `4/20 is getting close and I've been watching the menus daily across all ${stats.okStores} licensed NYC dispensaries. Here's what the data actually shows.

Current baseline:
- Cheapest eighth: $${stats.cheapestEighth.price} (${stats.cheapestEighth.neighborhood})
- Most expensive eighth: $${stats.expensiveEighth.price}
- Average eighth: ~$${stats.avgEighth}
- Cheapest ounce: $${stats.cheapestOunce?.price ?? "—"}
${dropLines}
A real deal is a price below the store's own baseline from the past week. A fake deal is a store that marks their menu "4/20 SPECIAL" when the price hasn't moved.

I've been tracking daily so when actual deals go live I'll have the before/after numbers to prove it. Worth checking before you walk in anywhere this weekend.`;

  return { sub, title, body };
}

function postDay420(stats, drops) {
  const sub   = "NYCcannabis";
  const title = `Happy 4/20 NYC — pulled this morning's prices from all ${stats.okStores} licensed stores`;

  const dropLines = drops.length
    ? `\nActual price drops vs yesterday:\n${drops.map(d => `- ${d.store} (${d.neighborhood}): $${d.oldPrice} → $${d.newPrice} on eighths (${d.pct}% drop)`).join("\n")}\n`
    : "\nPrices haven't shifted much yet from yesterday — check back later today.\n";

  const body = `Updated as of this morning's scrape.

Right now:
- Cheapest eighth: $${stats.cheapestEighth.price} at ${stats.cheapestEighth.store} (${stats.cheapestEighth.neighborhood})
- Cheapest ounce: $${stats.cheapestOunce?.price ?? "—"} at ${stats.cheapestOunce?.store ?? "—"}
- Average eighth across all ${stats.okStores} stores: ~$${stats.avgEighth}
${dropLines}
Full price comparison across all stores: nycweedprice.org/420-deals/

Enjoy the day ✌️`;

  return { sub, title, body };
}

function postWeekly(stats, drops) {
  const sub   = "NYCcannabis";
  const dayName = new Date().toLocaleDateString("en-US", { weekday: "long" });
  const title = `${dayName} NYC dispensary price check — cheapest eighth is $${stats.cheapestEighth.price} right now`;

  const dropLines = drops.length
    ? `\nPrice drops since yesterday:\n${drops.slice(0, 3).map(d => `- ${d.store}: $${d.oldPrice} → $${d.newPrice} on eighths (${d.pct}% drop)`).join("\n")}\n`
    : "";

  const body = `Weekly price check across all ${stats.okStores} licensed NYC dispensaries.

Today's spread:
- Cheapest eighth: $${stats.cheapestEighth.price} (${stats.cheapestEighth.neighborhood})
- Most expensive eighth: $${stats.expensiveEighth.price}
- Cheapest ounce: $${stats.cheapestOunce?.price ?? "—"}
- Average eighth: ~$${stats.avgEighth}
${dropLines}
Prices update daily — full comparison at nycweedprice.org`;

  return { sub, title, body };
}

// ─── Pick today's post ────────────────────────────────────────────────────

function selectPost(stats, drops) {
  const today = new Date();
  const d420  = daysUntil420();
  const month = today.getMonth(); // 0-indexed
  const day   = today.getDate();
  const dow   = today.getDay(); // 0=Sun

  // 4/20 itself
  if (month === 3 && day === 20) return { ...postDay420(stats, drops), type: "420-day" };

  // 4/20 countdown window (Apr 14–19)
  if (month === 3 && day >= 14 && day <= 19) {
    if (day === 14) return { ...postPriceSpread(stats, drops, d420), type: "420-countdown", sub: "NYCcannabis" };
    if (day === 15) return { ...postTrees(stats, d420), type: "420-countdown" };
    if (day === 16) return { ...postPerGram(stats, d420), type: "420-countdown" };
    if (day === 17) return { ...postDealsVsMarketing(stats, drops), type: "420-countdown" };
    if (day === 18) return { ...postTrees(stats, d420), type: "420-countdown", sub: "trees" };
    if (day === 19) return { ...postDealsVsMarketing(stats, drops), type: "420-countdown" };
  }

  // Pre-4/20 warmup (now–Apr 13): karma comments only
  if (month === 3 && day < 14) {
    return { type: "karma-only", sub: null, title: null, body: null };
  }

  // Post-4/20: weekly Monday posts
  if (dow === 1) return { ...postWeekly(stats, drops), type: "weekly" };

  // Other days post-4/20: no post today
  return { type: "off-day", sub: null, title: null, body: null };
}

// ─── Build Reddit pre-fill URL ─────────────────────────────────────────────

function redditUrl(sub, title, body) {
  const base = `https://www.reddit.com/r/${sub}/submit`;
  const params = new URLSearchParams({ title, selftext: body });
  return `${base}?${params.toString()}`;
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const data = await readJson(TODAY_JSON);
  if (!data || !Array.isArray(data)) {
    console.log("[reddit-post] No price data found — skipping.");
    return;
  }

  const stats = computeStats(data);
  const drops = await getDrops(data);
  const post  = selectPost(stats, drops);
  const today = dateStamp();
  const d420  = daysUntil420();

  let output = `# Reddit Draft — ${today}\n`;
  output += `# Days until 4/20: ${d420}\n`;
  output += `# Type: ${post.type}\n\n`;

  if (post.type === "karma-only") {
    output += `## Today: Karma-building phase (post nothing until April 14)\n\n`;
    output += `Drop 2–3 helpful comments in r/NYCcannabis, r/trees, r/FuckCombustion.\n`;
    output += `No links. Answer questions with data. Build account credibility.\n\n`;
    output += `--- SAMPLE KARMA COMMENT ---\n`;
    output += `Prices vary a lot more than you'd think across the licensed stores — `;
    output += `like $${stats.spread}+ difference on the same eighth depending on where you walk in. `;
    output += `Right now the cheapest eighth in the city is around $${stats.cheapestEighth?.price ?? "??"} `;
    output += `at spots in ${stats.cheapestEighth?.neighborhood ?? "various neighborhoods"}. `;
    output += `Worth checking a few menus before you go rather than walking into the nearest one.\n`;
  } else if (post.type === "off-day") {
    output += `## Today: No post scheduled (post on Mondays + Apr 14–20)\n\n`;
    output += `Current stats for reference:\n`;
    output += `- Cheapest eighth: $${stats.cheapestEighth?.price} at ${stats.cheapestEighth?.store}\n`;
    output += `- Cheapest ounce: $${stats.cheapestOunce?.price} at ${stats.cheapestOunce?.store}\n`;
    output += `- Price spread on eighths: $${stats.spread}\n`;
  } else {
    output += `## Subreddit: r/${post.sub}\n\n`;
    output += `## TITLE (copy this):\n${post.title}\n\n`;
    output += `## BODY (copy this):\n${post.body}\n\n`;
    output += `## FIRST COMMENT (post yourself within 5 min of submitting):\n`;
    output += `For the actual numbers updated daily: nycweedprice.org — free, no account needed. `;
    output += `Also has email alerts for when specific stores drop prices.\n\n`;
    output += `## ONE-CLICK REDDIT URL (opens pre-filled submit form):\n`;
    output += redditUrl(post.sub, post.title, post.body) + "\n\n";
    output += `---\nSTATS USED IN THIS POST:\n`;
    output += `Stores scraped: ${stats.okStores}\n`;
    output += `Cheapest eighth: $${stats.cheapestEighth?.price} @ ${stats.cheapestEighth?.store}\n`;
    output += `Most expensive eighth: $${stats.expensiveEighth?.price} @ ${stats.expensiveEighth?.store}\n`;
    output += `Cheapest ounce: $${stats.cheapestOunce?.price} @ ${stats.cheapestOunce?.store}\n`;
    output += `Average eighth: ~$${stats.avgEighth}\n`;
    output += `Price spread: $${stats.spread}\n`;
    if (drops.length) {
      output += `Price drops vs yesterday: ${drops.map(d => `${d.store} -${d.pct}%`).join(", ")}\n`;
    }
  }

  await fs.mkdir(OUTPUT_DIR, { recursive: true });
  await fs.writeFile(DRAFT_FILE, output, "utf8");

  console.log(`[reddit-post] Draft written → output/reddit-draft.txt`);
  console.log(`[reddit-post] Type: ${post.type} | Days to 4/20: ${d420}`);
  if (post.sub) console.log(`[reddit-post] Target: r/${post.sub}`);
  if (post.title) console.log(`[reddit-post] Title: ${post.title}`);
}

main().catch(err => { console.error("[reddit-post] Error:", err); process.exit(1); });
