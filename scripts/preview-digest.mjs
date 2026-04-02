/**
 * preview-digest.mjs — generates output/digest-preview.html with real data.
 * Run: node scripts/preview-digest.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HISTORY_DIR = path.join(ROOT, "output", "history");
const SITE_URL = "https://nycweedprice.org";
const SIZES = ["1 oz", "1/2 oz", "1/4 oz", "1/8 oz"];
const SIZE_LABEL = { "1 oz": "1 oz", "1/2 oz": "1/2 oz", "1/4 oz": "1/4 oz", "1/8 oz": "1/8 oz" };

function dateStamp(d) { return d.toISOString().slice(0, 10); }
function lastNDays(n) {
  const days = [];
  for (let i = n; i >= 1; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push(dateStamp(d)); }
  return days;
}
function friendlyDate(stamp) {
  return new Date(stamp + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
function cheapestPerSize(store) {
  const result = new Map();
  for (const { key, size } of [
    { key: "eighthOunceListings", size: "1/8 oz" },
    { key: "quarterOunceListings", size: "1/4 oz" },
    { key: "halfOunceListings", size: "1/2 oz" },
    { key: "ounceListings", size: "1 oz" },
  ]) {
    const listings = (store[key] ?? []).filter(l => !l.preGround && l.price > 0);
    if (!listings.length) continue;
    listings.sort((a, b) => a.price - b.price);
    result.set(size, { price: listings[0].price, product: listings[0].product ?? "" });
  }
  return result;
}
async function loadHistory(stamps) {
  const result = new Map();
  for (const stamp of stamps) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(HISTORY_DIR, stamp + ".json"), "utf8"));
      if (Array.isArray(data)) result.set(stamp, data);
    } catch { /* skip */ }
  }
  return result;
}
function weeklyBestPrices(history) {
  const best = new Map();
  for (const [stamp, stores] of history) {
    for (const store of stores) {
      if (store.status !== "ok") continue;
      for (const [size, { price, product }] of cheapestPerSize(store)) {
        const prev = best.get(size);
        if (!prev || price < prev.price)
          best.set(size, { price, storeName: store.name, neighborhood: store.neighborhood ?? "", date: stamp, product });
      }
    }
  }
  return best;
}
function biggestWeeklyDrop(history) {
  const stamps = [...history.keys()].sort(); let best = null;
  for (let i = 1; i < stamps.length; i++) {
    const prevDay = history.get(stamps[i - 1]);
    const currDay = history.get(stamps[i]);
    const prevMap = new Map(prevDay.map(s => [s.name, s]));
    for (const store of currDay) {
      if (store.status !== "ok") continue;
      const prevStore = prevMap.get(store.name);
      if (!prevStore || prevStore.status !== "ok") continue;
      const currSizes = cheapestPerSize(store);
      const prevSizes = cheapestPerSize(prevStore);
      for (const [size, { price: newPrice }] of currSizes) {
        const prev = prevSizes.get(size); if (!prev) continue;
        const drop = prev.price - newPrice;
        if (drop > 0 && (!best || drop > best.drop))
          best = { storeName: store.name, neighborhood: store.neighborhood ?? "", size, oldPrice: prev.price, newPrice, drop, date: stamps[i] };
      }
    }
  }
  return best;
}
function mostConsistentStore(history) {
  const series = new Map();
  for (const [, stores] of history) {
    for (const store of stores) {
      if (store.status !== "ok") continue;
      if (!series.has(store.name)) series.set(store.name, new Map());
      for (const [size, { price }] of cheapestPerSize(store)) {
        const sm = series.get(store.name);
        if (!sm.has(size)) sm.set(size, []);
        sm.get(size).push(price);
      }
    }
  }
  let best = null;
  for (const [storeName, sizeMap] of series) {
    for (const size of ["1/8 oz", "1/4 oz", "1/2 oz", "1 oz"]) {
      const prices = sizeMap.get(size);
      if (!prices || prices.length < 2) continue;
      const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
      const cv = mean > 0 ? Math.sqrt(prices.reduce((s, p) => s + (p - mean) ** 2, 0) / prices.length) / mean : Infinity;
      let neighborhood = "";
      for (const [, stores] of history) { const s = stores.find(x => x.name === storeName); if (s) { neighborhood = s.neighborhood ?? ""; break; } }
      if (!best || cv < best.cv) best = { storeName, neighborhood, avgPrice: Math.round(mean), size, cv };
      break;
    }
  }
  return best;
}

// ── Rendering ──────────────────────────────────────────────────────────────
function slug(name) { return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

function priceRowHtml({ size, price, storeName, neighborhood, date, product }) {
  const trunc = product.length > 48 ? product.slice(0, 45) + "…" : product;
  return `<tr>
    <td style="padding:14px 16px;border-bottom:1px solid #1E1E1E;white-space:nowrap;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#666">${SIZE_LABEL[size]}</td>
    <td style="padding:14px 16px;border-bottom:1px solid #1E1E1E;white-space:nowrap"><span style="background:#C8FF00;color:#0D0D0D;font-size:16px;font-weight:700;padding:3px 10px;border-radius:3px">$${price}</span></td>
    <td style="padding:14px 16px;border-bottom:1px solid #1E1E1E"><a href="${SITE_URL}/dispensaries/${slug(storeName)}/" style="color:#E8E4DC;text-decoration:none;font-weight:600;font-size:14px">${storeName}</a><div style="color:#555;font-size:12px;margin-top:2px">${neighborhood} &middot; ${friendlyDate(date)}</div></td>
    <td style="padding:14px 16px;border-bottom:1px solid #1E1E1E;font-size:12px;color:#555">${trunc}</td>
  </tr>`;
}

function priceTableHtml(bp) {
  if (!bp.size) return `<p style="color:#666;font-size:14px">No price data available this week.</p>`;
  const rows = SIZES.filter(s => bp.has(s)).map(size => priceRowHtml({ size, ...bp.get(size) }));
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#111;border-radius:4px;overflow:hidden">
    <thead><tr style="background:#0D0D0D">
      <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:#444;border-bottom:1px solid #1E1E1E">Size</th>
      <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:#444;border-bottom:1px solid #1E1E1E">Best Price</th>
      <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:#444;border-bottom:1px solid #1E1E1E">Store</th>
      <th style="padding:10px 16px;text-align:left;font-size:10px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:#444;border-bottom:1px solid #1E1E1E">Product</th>
    </tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>`;
}

function calloutHtml({ label, title, body }) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:8px">
    <tr><td style="background:#111;border-left:3px solid #C8FF00;border-radius:0 4px 4px 0;padding:16px 20px">
      <div style="font-size:10px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#C8FF00;margin-bottom:6px">${label}</div>
      <div style="font-size:15px;font-weight:600;color:#E8E4DC;margin-bottom:4px">${title}</div>
      <div style="font-size:13px;color:#666;line-height:1.5">${body}</div>
    </td></tr>
  </table>`;
}

function sectionHead(t) {
  return `<div style="margin:32px 0 14px"><span style="font-size:10px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#555">${t}</span></div>`;
}

function buildHtml({ dateRange, bestPrices, bigDrop, consistentStore }) {
  const eighth = bestPrices.get("1/8 oz");
  const heroLine = eighth
    ? `Cheapest eighth this week: <strong style="color:#C8FF00">$${eighth.price}</strong> at ${eighth.storeName}`
    : "Weekly cannabis price report for NYC";

  const dropHtml = bigDrop
    ? calloutHtml({ label: "Biggest Drop", title: `${bigDrop.storeName} — ${bigDrop.size} dropped $${bigDrop.drop}`, body: `Was $${bigDrop.oldPrice}, now $${bigDrop.newPrice} (${friendlyDate(bigDrop.date)}). ${bigDrop.neighborhood}.` })
    : `<p style="color:#555;font-size:14px">No significant drops this week.</p>`;

  const consistHtml = consistentStore
    ? calloutHtml({ label: "Most Consistent Value", title: consistentStore.storeName, body: `Averaged <strong style="color:#C8FF00">$${consistentStore.avgPrice}</strong> for a ${SIZE_LABEL[consistentStore.size]} all week. ${consistentStore.neighborhood}.` })
    : `<p style="color:#555;font-size:14px">Insufficient data this week.</p>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NYC Weed Price — Weekly Digest</title>
</head>
<body style="margin:0;padding:0;background:#0D0D0D;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0D0D0D">
<tr><td align="center" style="padding:24px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%">

  <!-- Header -->
  <tr><td style="background:#0D0D0D;padding:32px 32px 0;border-bottom:1px solid #1E1E1E">
    <div style="font-size:11px;font-weight:700;letter-spacing:.25em;text-transform:uppercase;color:#C8FF00;margin-bottom:10px">nycweedprice.org</div>
    <div style="font-size:28px;font-weight:700;color:#F0EDE6;line-height:1.1;margin-bottom:10px">Weekly Price Digest</div>
    <div style="font-size:13px;color:#555;margin-bottom:24px">${dateRange.start} &ndash; ${dateRange.end}</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #1E1E1E">
      <tr><td style="padding:14px 0;font-size:13px;color:#666">${heroLine}</td></tr>
    </table>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:#161616;padding:8px 32px 32px">
    ${sectionHead("Lowest Prices This Week")}
    ${priceTableHtml(bestPrices)}
    ${sectionHead("Biggest Single-Day Drop")}
    ${dropHtml}
    ${sectionHead("Most Consistent Value")}
    ${consistHtml}
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px">
      <tr><td>
        <a href="${SITE_URL}" style="display:inline-block;background:#C8FF00;color:#0D0D0D;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:14px 28px;border-radius:4px;text-decoration:none">See Today's Prices &rarr;</a>
      </td></tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#0D0D0D;border-top:1px solid #1E1E1E;padding:20px 32px">
    <p style="margin:0;font-size:12px;color:#444;line-height:1.6">
      You signed up for the weekly digest at <a href="${SITE_URL}" style="color:#666">nycweedprice.org</a>.
      Prices are pre-tax estimates scraped from official menus. 21+ only.<br>
      <a href="${SITE_URL}/unsubscribe" style="color:#555">Unsubscribe</a>
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

// ── Main ───────────────────────────────────────────────────────────────────
const stamps = lastNDays(7);
const history = await loadHistory(stamps);
const bestPrices = weeklyBestPrices(history);
const bigDrop = biggestWeeklyDrop(history);
const consistentStore = mostConsistentStore(history);
const sortedStamps = [...history.keys()].sort();
const dateRange = { start: friendlyDate(sortedStamps[0]), end: friendlyDate(sortedStamps[sortedStamps.length - 1]) };

const html = buildHtml({ dateRange, bestPrices, bigDrop, consistentStore });
const outPath = path.join(ROOT, "output", "digest-preview.html");
await fs.writeFile(outPath, html, "utf8");
console.log("Preview written to output/digest-preview.html");
console.log("Open: file://" + outPath.replace(/\\/g, "/"));
