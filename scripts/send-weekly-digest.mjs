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

function priceRowHtml({ size, price, storeName, neighborhood, date, product }) {
  const slug = storeName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const truncProd = product.length > 48 ? product.slice(0, 45) + "…" : product;
  return `
  <tr>
    <td style="padding:14px 16px;border-bottom:1px solid #1E1E1E;white-space:nowrap;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#666;">${SIZE_LABEL[size]}</td>
    <td style="padding:14px 16px;border-bottom:1px solid #1E1E1E;white-space:nowrap;">
      <span style="background:#C8FF00;color:#0D0D0D;font-size:16px;font-weight:700;padding:3px 10px;border-radius:3px;font-variant-numeric:tabular-nums;">$${price}</span>
    </td>
    <td style="padding:14px 16px;border-bottom:1px solid #1E1E1E;">
      <a href="${SITE_URL}/dispensaries/${slug}/" style="color:#E8E4DC;text-decoration:none;font-weight:600;font-size:14px;">${storeName}</a>
      <div style="color:#555;font-size:12px;margin-top:2px;">${neighborhood} &middot; ${friendlyDate(date)}</div>
    </td>
    <td style="padding:14px 16px;border-bottom:1px solid #1E1E1E;font-size:12px;color:#666;">${truncProd}</td>
  </tr>`.trim();
}

function priceTableHtml(bestPrices) {
  if (!bestPrices.size) return `<p style="color:#666;font-size:14px;">No price data available this week.</p>`;
  const rows = SIZES.filter((s) => bestPrices.has(s)).map((size) =>
    priceRowHtml({ size, ...bestPrices.get(size) })
  );
  return `
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#111;border-radius:4px;overflow:hidden;">
    <thead>
      <tr style="background:#0D0D0D;">
        <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:#444;border-bottom:1px solid #1E1E1E;">Size</th>
        <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:#444;border-bottom:1px solid #1E1E1E;">Best Price</th>
        <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:#444;border-bottom:1px solid #1E1E1E;">Store</th>
        <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:#444;border-bottom:1px solid #1E1E1E;">Product</th>
      </tr>
    </thead>
    <tbody>${rows.join("")}</tbody>
  </table>`;
}

function calloutHtml({ label, title, body }) {
  return `
  <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:8px;">
    <tr>
      <td style="background:#111;border-left:3px solid #C8FF00;border-radius:0 4px 4px 0;padding:16px 20px;">
        <div style="font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#C8FF00;margin-bottom:6px;">${label}</div>
        <div style="font-size:15px;font-weight:600;color:#E8E4DC;margin-bottom:4px;">${title}</div>
        <div style="font-size:13px;color:#666;line-height:1.5;">${body}</div>
      </td>
    </tr>
  </table>`;
}

function bigDropHtml(drop) {
  if (!drop) return `<p style="color:#555;font-size:14px;">No significant drops this week.</p>`;
  return calloutHtml({
    label: "Biggest Drop",
    title: `${drop.storeName} — ${drop.size} dropped $${drop.drop}`,
    body: `Was $${drop.oldPrice}, now $${drop.newPrice} (${friendlyDate(drop.date)}). ${drop.neighborhood}.`,
  });
}

function consistentStoreHtml(store) {
  if (!store) return `<p style="color:#555;font-size:14px;">Insufficient data this week.</p>`;
  return calloutHtml({
    label: "Most Consistent Value",
    title: `${store.storeName}`,
    body: `Averaged <strong style="color:#C8FF00;">$${store.avgPrice}</strong> for a ${SIZE_LABEL[store.size]} all week with minimal price swings. ${store.neighborhood}.`,
  });
}

function sectionHead(text) {
  return `<div style="margin:32px 0 14px;"><span style="font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#555;">${text}</span></div>`;
}

function buildHtml({ dateRange, bestPrices, bigDrop, consistentStore }) {
  const eighth = bestPrices.get("1/8 oz");
  const heroSubline = eighth
    ? `Cheapest eighth this week: <strong style="color:#C8FF00;">$${eighth.price}</strong> at ${eighth.storeName}`
    : `Weekly cannabis price report for NYC`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NYC Weed Price — Weekly Digest</title>
</head>
<body style="margin:0;padding:0;background:#0D0D0D;font-family:Arial,Helvetica,sans-serif;">

<!-- Wrapper -->
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0D0D0D;">
<tr><td align="center" style="padding:24px 16px;">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <!-- Header -->
  <tr>
    <td style="background:#0D0D0D;padding:32px 32px 0;border-bottom:1px solid #1E1E1E;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.25em;text-transform:uppercase;color:#C8FF00;margin-bottom:10px;">nycweedprice.org</div>
      <div style="font-size:28px;font-weight:700;color:#F0EDE6;line-height:1.1;margin-bottom:10px;">Weekly Price Digest</div>
      <div style="font-size:13px;color:#555;margin-bottom:24px;">${dateRange.start} &ndash; ${dateRange.end}</div>
      <!-- Hero stat strip -->
      <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #1E1E1E;">
        <tr>
          <td style="padding:14px 0;font-size:13px;color:#666;">${heroSubline}</td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="background:#161616;padding:8px 32px 32px;">

      ${sectionHead("Lowest Prices This Week")}
      ${priceTableHtml(bestPrices)}

      ${sectionHead("Biggest Single-Day Drop")}
      ${bigDropHtml(bigDrop)}

      ${sectionHead("Most Consistent Value")}
      ${consistentStoreHtml(consistentStore)}

      <!-- CTA -->
      <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px;">
        <tr>
          <td>
            <a href="${SITE_URL}" style="display:inline-block;background:#C8FF00;color:#0D0D0D;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:14px 28px;border-radius:4px;text-decoration:none;">See Today's Prices &rarr;</a>
          </td>
        </tr>
      </table>

    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#0D0D0D;border-top:1px solid #1E1E1E;padding:20px 32px;">
      <p style="margin:0;font-size:12px;color:#444;line-height:1.6;">
        You signed up for the weekly digest at <a href="${SITE_URL}" style="color:#666;">nycweedprice.org</a>.
        Prices are pre-tax estimates scraped from official dispensary menus. 21+ only.<br>
        <a href="${SITE_URL}/unsubscribe" style="color:#555;">Unsubscribe</a>
      </p>
    </td>
  </tr>

</table>
</td></tr>
</table>

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
