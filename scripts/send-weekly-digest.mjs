/**
 * scripts/send-weekly-digest.mjs
 *
 * Runs every Monday at 8am (via Windows Task Scheduler).
 * Reads the last 7 days of history files from output/history/,
 * computes the week's highlights (lowest price per size, biggest
 * single-day drop, most consistent-value store), then sends an HTML
 * email to all subscribers in logs/alert-signups.jsonl via Resend.
 *
 * Exits cleanly (exit 0) when RESEND_API_KEY is absent or there are
 * no subscribers.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HISTORY_DIR = path.join(ROOT, "output", "history");
const LOGS_DIR = path.join(ROOT, "logs");
const SIGNUPS_FILE = path.join(LOGS_DIR, "alert-signups.jsonl");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const FROM_ADDRESS = "NYC Weed Price <digest@nycweedprice.org>";
const SITE_URL = "https://nycweedprice.org";

// Ordered from largest to smallest for display
const SIZES = ["1 oz", "1/2 oz", "1/4 oz", "1/8 oz"];
const SIZE_LABEL = {
  "1 oz": "1 oz",
  "1/2 oz": "1/2 oz",
  "1/4 oz": "1/4 oz",
  "1/8 oz": "1/8 oz",
};

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function dateStamp(d) {
  return d.toISOString().slice(0, 10);
}

/** Return an array of the last N date strings ending yesterday (inclusive). */
function lastNDays(n) {
  const days = [];
  for (let i = n; i >= 1; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(dateStamp(d));
  }
  return days;
}

/** Format YYYY-MM-DD as "Mon Apr 1" */
function friendlyDate(stamp) {
  const d = new Date(stamp + "T12:00:00Z"); // noon UTC avoids DST edge cases
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

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
      const { email } = JSON.parse(trimmed);
      if (email && typeof email === "string") {
        const normalized = email.toLowerCase().trim();
        map.set(normalized, normalized);
      }
    } catch {
      // malformed line — skip
    }
  }
  return [...map.values()];
}

// ---------------------------------------------------------------------------
// Data extraction
// ---------------------------------------------------------------------------

/**
 * For a store, return cheapest non-pre-ground price per size bucket.
 * Returns a Map<size, { price, product }>
 */
function cheapestPerSize(store) {
  const result = new Map();
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
    result.set(size, { price: listings[0].price, product: listings[0].product ?? "" });
  }
  return result;
}

/**
 * Load all available history files for the given date stamps.
 * Returns Map<dateStamp, storeArray>
 */
async function loadHistory(stamps) {
  const result = new Map();
  for (const stamp of stamps) {
    const data = await readJson(path.join(HISTORY_DIR, `${stamp}.json`));
    if (data && Array.isArray(data)) result.set(stamp, data);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

/**
 * Lowest price seen for each size across all days and all stores.
 * Returns Map<size, { price, storeName, date, product }>
 */
function weeklyBestPrices(history) {
  const best = new Map();
  for (const [stamp, stores] of history) {
    for (const store of stores) {
      if (store.status !== "ok") continue;
      for (const [size, { price, product }] of cheapestPerSize(store)) {
        const prev = best.get(size);
        if (!prev || price < prev.price) {
          best.set(size, {
            price,
            storeName: store.name,
            neighborhood: store.neighborhood ?? "",
            date: stamp,
            product,
          });
        }
      }
    }
  }
  return best;
}

/**
 * Biggest single-day price drop (absolute $) for any store+size pair
 * between consecutive available days.
 * Returns { storeName, neighborhood, size, oldPrice, newPrice, drop, date } or null.
 */
function biggestWeeklyDrop(history) {
  const stamps = [...history.keys()].sort();
  let best = null;

  for (let i = 1; i < stamps.length; i++) {
    const prevDay = history.get(stamps[i - 1]);
    const currDay = history.get(stamps[i]);

    const prevMap = new Map(prevDay.map((s) => [s.name, s]));

    for (const store of currDay) {
      if (store.status !== "ok") continue;
      const prevStore = prevMap.get(store.name);
      if (!prevStore || prevStore.status !== "ok") continue;

      const currSizes = cheapestPerSize(store);
      const prevSizes = cheapestPerSize(prevStore);

      for (const [size, { price: newPrice }] of currSizes) {
        const prev = prevSizes.get(size);
        if (!prev) continue;
        const drop = prev.price - newPrice;
        if (drop > 0 && (!best || drop > best.drop)) {
          best = {
            storeName: store.name,
            neighborhood: store.neighborhood ?? "",
            size,
            oldPrice: prev.price,
            newPrice,
            drop,
            date: stamps[i],
          };
        }
      }
    }
  }
  return best;
}

/**
 * Most consistent-value store: the store whose cheapest 1/8 oz price
 * has the smallest coefficient of variation (std dev / mean) across
 * the week — meaning it reliably offers a good price.
 * Falls back to 1/4 oz, then 1/2 oz if 1/8 oz data is sparse.
 * Returns { storeName, neighborhood, avgPrice, size } or null.
 */
function mostConsistentStore(history) {
  // Collect price series per store per size
  const series = new Map(); // storeName → Map<size, number[]>

  for (const [, stores] of history) {
    for (const store of stores) {
      if (store.status !== "ok") continue;
      if (!series.has(store.name)) series.set(store.name, new Map());
      for (const [size, { price }] of cheapestPerSize(store)) {
        const sizeMap = series.get(store.name);
        if (!sizeMap.has(size)) sizeMap.set(size, []);
        sizeMap.get(size).push(price);
      }
    }
  }

  const MIN_DAYS = 3; // must appear at least this many days to qualify
  let best = null;

  for (const [storeName, sizeMap] of series) {
    // Try sizes in preference order
    for (const size of ["1/8 oz", "1/4 oz", "1/2 oz", "1 oz"]) {
      const prices = sizeMap.get(size);
      if (!prices || prices.length < MIN_DAYS) continue;

      const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
      const variance =
        prices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / prices.length;
      const cv = mean > 0 ? Math.sqrt(variance) / mean : Infinity;

      if (!best || cv < best.cv || (cv === best.cv && mean < best.mean)) {
        // Also find the neighborhood from the last history entry
        let neighborhood = "";
        for (const [, stores] of history) {
          const s = stores.find((x) => x.name === storeName);
          if (s) { neighborhood = s.neighborhood ?? ""; break; }
        }
        best = { storeName, neighborhood, avgPrice: Math.round(mean), size, cv, mean };
      }
      break; // use first qualifying size for this store
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Email rendering
// ---------------------------------------------------------------------------

const CSS = `
  body { font-family: Arial, Helvetica, sans-serif; font-size: 15px;
         color: #1a1a1a; background: #f5f5f5; margin: 0; padding: 0; }
  .wrap { max-width: 600px; margin: 24px auto; background: #fff;
          border-radius: 8px; overflow: hidden;
          box-shadow: 0 1px 4px rgba(0,0,0,.12); }
  .header { background: #1a4d2e; color: #fff; padding: 24px 28px 18px; }
  .header h1 { margin: 0; font-size: 22px; }
  .header p { margin: 6px 0 0; font-size: 13px; opacity: .8; }
  .body { padding: 24px 28px; }
  h2 { font-size: 16px; color: #1a4d2e; margin: 24px 0 10px; border-bottom: 1px solid #e0e0e0; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 8px; }
  th { text-align: left; padding: 6px 10px; background: #f0f0f0; font-weight: 600; }
  td { padding: 7px 10px; border-bottom: 1px solid #efefef; }
  tr:last-child td { border-bottom: none; }
  .highlight { background: #eaf4ee; }
  .badge { display: inline-block; background: #1a4d2e; color: #fff;
           border-radius: 4px; padding: 2px 7px; font-size: 12px; font-weight: 700; }
  .callout { background: #eaf4ee; border-left: 4px solid #1a4d2e;
             padding: 12px 16px; border-radius: 0 6px 6px 0; margin: 0 0 16px; }
  .callout strong { display: block; font-size: 15px; margin-bottom: 2px; }
  .callout span { font-size: 13px; color: #444; }
  .footer { padding: 16px 28px; background: #f5f5f5; font-size: 12px; color: #888; }
  .footer a { color: #1a4d2e; }
  a { color: #1a4d2e; }
`.trim();

function priceTableHtml(bestPrices) {
  if (!bestPrices.size) return "<p>No price data available this week.</p>";

  const rows = SIZES
    .filter((s) => bestPrices.has(s))
    .map((size) => {
      const { price, storeName, neighborhood, date, product } = bestPrices.get(size);
      const truncProd = product.length > 55 ? product.slice(0, 52) + "..." : product;
      return `
        <tr>
          <td><strong>${SIZE_LABEL[size]}</strong></td>
          <td><span class="badge">$${price}</span></td>
          <td>${storeName}<br><small style="color:#666">${neighborhood} · ${friendlyDate(date)}</small></td>
          <td style="font-size:12px;color:#555">${truncProd}</td>
        </tr>`.trim();
    });

  return `
    <table>
      <thead><tr>
        <th>Size</th><th>Best Price</th><th>Store</th><th>Product</th>
      </tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>`;
}

function bigDropHtml(drop) {
  if (!drop) return "<p>No significant single-day drops this week.</p>";
  return `
    <div class="callout">
      <strong>${drop.storeName} (${drop.neighborhood})</strong>
      <span>${drop.size}: $${drop.oldPrice} → $${drop.newPrice} on ${friendlyDate(drop.date)}
      — a $${drop.drop} drop in one day.</span>
    </div>`;
}

function consistentStoreHtml(store) {
  if (!store) return "<p>Insufficient data this week.</p>";
  return `
    <div class="callout">
      <strong>${store.storeName} (${store.neighborhood})</strong>
      <span>Averaged $${store.avgPrice} for a ${SIZE_LABEL[store.size]} all week with minimal price swings.</span>
    </div>`;
}

function buildHtml({ dateRange, bestPrices, bigDrop, consistentStore }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NYC Weed Prices — Weekly Digest</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>NYC Weed Price Digest</h1>
    <p>${dateRange.start} – ${dateRange.end}</p>
  </div>
  <div class="body">
    <h2>Lowest prices this week</h2>
    ${priceTableHtml(bestPrices)}

    <h2>Biggest single-day drop</h2>
    ${bigDropHtml(bigDrop)}

    <h2>Most consistent value</h2>
    ${consistentStoreHtml(consistentStore)}

    <p style="margin-top:24px">
      <a href="${SITE_URL}">See all current prices at nycweedprice.org →</a>
    </p>
  </div>
  <div class="footer">
    You're receiving this because you signed up for the weekly digest at
    <a href="${SITE_URL}">nycweedprice.org</a>.
    To unsubscribe, reply with "unsubscribe" in the subject line.
  </div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Email delivery
// ---------------------------------------------------------------------------

async function sendEmail({ to, subject, html }) {
  const body = JSON.stringify({
    from: FROM_ADDRESS,
    to: [to],
    subject,
    html,
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
  try { errText = await res.text(); } catch {}
  console.error(`  Resend error ${res.status} for ${to}: ${errText.slice(0, 200)}`);
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!RESEND_API_KEY) {
    console.log("[weekly-digest] RESEND_API_KEY not set — skipping.");
    process.exit(0);
  }

  const subscribers = await loadSubscribers();
  if (!subscribers.length) {
    console.log("[weekly-digest] No subscribers — skipping.");
    process.exit(0);
  }

  // Collect last 7 days (yesterday through 7 days ago)
  const stamps = lastNDays(7);
  const history = await loadHistory(stamps);

  if (!history.size) {
    console.log("[weekly-digest] No history files found for the last 7 days — skipping.");
    process.exit(0);
  }

  console.log(`[weekly-digest] Loaded ${history.size} day(s) of history.`);

  // Compute analytics
  const bestPrices = weeklyBestPrices(history);
  const bigDrop = biggestWeeklyDrop(history);
  const consistentStore = mostConsistentStore(history);

  // Date range label
  const sortedStamps = [...history.keys()].sort();
  const dateRange = {
    start: friendlyDate(sortedStamps[0]),
    end: friendlyDate(sortedStamps[sortedStamps.length - 1]),
  };

  // Build email content
  const html = buildHtml({ dateRange, bestPrices, bigDrop, consistentStore });

  // Subject: use cheapest 1/8 price for hook if available
  let subjectHook = "";
  const eighth = bestPrices.get("1/8 oz");
  if (eighth) {
    subjectHook = ` — 1/8 oz from $${eighth.price}`;
  }
  const subject = `NYC weed prices this week${subjectHook} [${dateRange.start} – ${dateRange.end}]`;

  console.log(`[weekly-digest] Sending to ${subscribers.length} subscriber(s)...`);

  let sentCount = 0;
  for (const email of subscribers) {
    const ok = await sendEmail({ to: email, subject, html });
    if (ok) {
      sentCount++;
      console.log(`  Sent to ${email}`);
    }
  }

  console.log(`[weekly-digest] Done. Sent: ${sentCount}/${subscribers.length}.`);
}

main().catch((err) => {
  console.error("[weekly-digest] Fatal error:", err);
  process.exit(1);
});
