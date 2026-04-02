/**
 * scripts/send-price-alerts.mjs
 *
 * Reads today's scrape output and yesterday's history file, finds listings
 * that dropped 15%+ in price at the cheapest-per-size level for each store,
 * deduplicates the subscriber list from logs/alert-signups.jsonl, enforces a
 * max-2-alerts-per-email-per-week rate limit tracked in logs/alert-state.json,
 * then sends plain-text price-drop alerts via Resend.
 *
 * Called from auto-scrape.bat immediately after a successful scrape.
 * Exits cleanly (exit code 0) on missing API key or no subscribers.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(ROOT, "output");
const HISTORY_DIR = path.join(OUTPUT_DIR, "history");
const TODAY_JSON = path.join(OUTPUT_DIR, "dispensary-prices.json");
const LOGS_DIR = path.join(ROOT, "logs");
const SIGNUPS_FILE = path.join(LOGS_DIR, "alert-signups.jsonl");
const STATE_FILE = path.join(LOGS_DIR, "alert-state.json");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const FROM_ADDRESS = "NYC Weed Price <alerts@nycweedprice.org>";
const DROP_THRESHOLD = 0.15;   // 15% price drop triggers an alert
const MAX_ALERTS_PER_WEEK = 2; // per email address
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Size labels used for subject line copy
// ---------------------------------------------------------------------------
const SIZE_LABEL = {
  "1/8 oz": "8th",
  "1/4 oz": "qtr",
  "1/2 oz": "half oz",
  "1 oz": "oz",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return YYYY-MM-DD for a Date, defaulting to today. */
function dateStamp(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

/** Return YYYY-MM-DD for yesterday. */
function yesterdayStamp() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dateStamp(d);
}

/** Read a JSON file; return null on any error. */
async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

/** Read logs/alert-state.json, creating it if missing. */
async function loadState() {
  const raw = await readJson(STATE_FILE);
  // Shape: { [email]: { sentAt: [ISO string, ...] } }
  return raw ?? {};
}

/** Persist state back to disk. */
async function saveState(state) {
  await fs.mkdir(LOGS_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

/**
 * Count how many alerts were sent to this email in the last 7 days.
 * Prunes old entries in-place as a side effect.
 */
function recentAlertCount(state, email) {
  const now = Date.now();
  const record = state[email] ?? { sentAt: [] };
  record.sentAt = record.sentAt.filter(
    (ts) => now - new Date(ts).getTime() < MS_PER_WEEK
  );
  state[email] = record;
  return record.sentAt.length;
}

/** Record that an alert was sent to this email right now. */
function recordSent(state, email) {
  state[email] = state[email] ?? { sentAt: [] };
  state[email].sentAt.push(new Date().toISOString());
}

/**
 * Read logs/alert-signups.jsonl, deduplicate by email (last entry wins),
 * and return an array of email strings.
 */
async function loadSubscribers() {
  let raw;
  try {
    raw = await fs.readFile(SIGNUPS_FILE, "utf8");
  } catch {
    return [];
  }

  const map = new Map();
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const { email, ts } = JSON.parse(trimmed);
      if (email && typeof email === "string") {
        map.set(email.toLowerCase().trim(), { email: email.toLowerCase().trim(), ts });
      }
    } catch {
      // malformed line — skip
    }
  }
  return [...map.values()].map((v) => v.email);
}

/**
 * For a store entry, return an array of { size, price, product } objects for
 * the cheapest real-flower listing in each size bucket.
 */
function cheapestBySize(store) {
  const results = [];
  const buckets = [
    { key: "eighthOunceListings", size: "1/8 oz" },
    { key: "quarterOunceListings", size: "1/4 oz" },
    { key: "halfOunceListings", size: "1/2 oz" },
    { key: "ounceListings", size: "1 oz" },
  ];
  for (const { key, size } of buckets) {
    const listings = (store[key] ?? []).filter((l) => !l.preGround && l.price > 0);
    if (!listings.length) continue;
    listings.sort((a, b) => a.price - b.price);
    const cheapest = listings[0];
    results.push({ size, price: cheapest.price, product: cheapest.product ?? "" });
  }
  return results;
}

/**
 * Compare today vs yesterday for all stores.
 * Returns array of alert objects:
 *   { storeName, address, neighborhood, size, oldPrice, newPrice, pctDrop, product }
 */
function findDrops(todayData, yesterdayData) {
  if (!Array.isArray(todayData) || !Array.isArray(yesterdayData)) return [];

  // Index yesterday by store name
  const yMap = new Map();
  for (const store of yesterdayData) {
    if (store.name) yMap.set(store.name, store);
  }

  const drops = [];
  for (const store of todayData) {
    if (store.status !== "ok" || !store.name) continue;
    const yesterday = yMap.get(store.name);
    if (!yesterday || yesterday.status !== "ok") continue;

    const todaySizes = cheapestBySize(store);
    const yesterdaySizes = new Map(
      cheapestBySize(yesterday).map((s) => [s.size, s])
    );

    for (const { size, price: newPrice, product } of todaySizes) {
      const prev = yesterdaySizes.get(size);
      if (!prev) continue;
      const oldPrice = prev.price;
      if (oldPrice <= 0) continue;
      const pctDrop = (oldPrice - newPrice) / oldPrice;
      if (pctDrop >= DROP_THRESHOLD) {
        drops.push({
          storeName: store.name,
          address: store.address ?? "",
          neighborhood: store.neighborhood ?? "",
          size,
          oldPrice,
          newPrice,
          pctDrop,
          product,
        });
      }
    }
  }

  // Most dramatic drop first
  drops.sort((a, b) => b.pctDrop - a.pctDrop);
  return drops;
}

/**
 * Build plain-text email body for a single alert candidate.
 * We send one email per subscriber that covers ALL qualifying drops.
 */
function buildAlertBody(drops) {
  const lines = [
    "Hi,",
    "",
    "NYC weed prices dropped at one or more dispensaries today.",
    "",
  ];

  for (const d of drops) {
    const sizeCopy = SIZE_LABEL[d.size] ?? d.size;
    const pct = Math.round(d.pctDrop * 100);
    lines.push(`${d.storeName} (${d.neighborhood})`);
    lines.push(
      `  ${d.size}: $${d.newPrice} today vs $${d.oldPrice} yesterday (${pct}% drop)`
    );
    if (d.product) {
      // Truncate very long product names for readability
      const prod = d.product.length > 70 ? d.product.slice(0, 67) + "..." : d.product;
      lines.push(`  Cheapest listing: ${prod}`);
    }
    lines.push("");
  }

  lines.push("See all NYC prices: https://nycweedprice.org");
  lines.push("");
  lines.push(
    "You're receiving this because you signed up for price drop alerts at nycweedprice.org."
  );
  lines.push(
    "To unsubscribe reply with 'unsubscribe' in the subject line."
  );

  return lines.join("\n");
}

/**
 * Build the email subject for the most notable drop.
 * Uses the largest price drop for the subject hook.
 */
function buildSubject(drops) {
  const top = drops[0];
  const sizeCopy = SIZE_LABEL[top.size] ?? top.size;
  return `Price drop: $${top.newPrice}/${sizeCopy} at ${top.storeName} today`;
}

/**
 * Send a single email via Resend REST API using Node's built-in fetch.
 * Returns true on success, false on failure.
 */
async function sendEmail({ to, subject, text }) {
  const body = JSON.stringify({
    from: FROM_ADDRESS,
    to: [to],
    subject,
    text,
  });

  let res;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body,
    });
  } catch (err) {
    console.error(`  Network error sending to ${to}: ${err.message}`);
    return false;
  }

  if (res.ok) return true;

  let errText = "";
  try {
    errText = await res.text();
  } catch {}
  console.error(`  Resend error ${res.status} for ${to}: ${errText.slice(0, 200)}`);
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  // Guard: exit cleanly if no API key
  if (!RESEND_API_KEY) {
    console.log("[price-alerts] RESEND_API_KEY not set — skipping.");
    process.exit(0);
  }

  // Load today's data
  const todayData = await readJson(TODAY_JSON);
  if (!todayData) {
    console.log("[price-alerts] Could not read today's price data — skipping.");
    process.exit(0);
  }

  // Load yesterday's history
  const ystamp = yesterdayStamp();
  const yesterdayData = await readJson(path.join(HISTORY_DIR, `${ystamp}.json`));
  if (!yesterdayData) {
    console.log(`[price-alerts] No history file for ${ystamp} — skipping.`);
    process.exit(0);
  }

  // Find qualifying drops
  const drops = findDrops(todayData, yesterdayData);
  if (!drops.length) {
    console.log("[price-alerts] No price drops >= 15% today — nothing to send.");
    process.exit(0);
  }

  console.log(`[price-alerts] Found ${drops.length} qualifying drop(s):`);
  for (const d of drops) {
    console.log(
      `  ${d.storeName} ${d.size}: $${d.oldPrice} → $${d.newPrice} (${Math.round(d.pctDrop * 100)}%)`
    );
  }

  // Load subscribers
  const subscribers = await loadSubscribers();
  if (!subscribers.length) {
    console.log("[price-alerts] No subscribers — nothing to send.");
    process.exit(0);
  }

  // Load rate-limit state
  const state = await loadState();

  // Build shared email content (same for all recipients)
  const subject = buildSubject(drops);
  const text = buildAlertBody(drops);

  let sentCount = 0;
  let skippedCount = 0;

  for (const email of subscribers) {
    const recent = recentAlertCount(state, email);
    if (recent >= MAX_ALERTS_PER_WEEK) {
      skippedCount++;
      console.log(`  Skipped ${email} (${recent} alerts sent this week)`);
      continue;
    }

    const ok = await sendEmail({ to: email, subject, text });
    if (ok) {
      recordSent(state, email);
      sentCount++;
      console.log(`  Sent to ${email}`);
    }
  }

  // Persist updated state
  await saveState(state);

  console.log(
    `[price-alerts] Done. Sent: ${sentCount}, Skipped (rate-limited): ${skippedCount}.`
  );
}

main().catch((err) => {
  console.error("[price-alerts] Fatal error:", err);
  process.exit(1);
});
