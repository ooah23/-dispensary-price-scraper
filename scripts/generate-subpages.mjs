/**
 * generate-subpages.mjs
 * Generates public/dispensaries/{slug}/index.html for each dispensary.
 * Run after scrape-leafly.mjs: node scripts/generate-subpages.mjs
 */
import fs from "node:fs/promises";
import path from "node:path";

const PRICES_PATH  = path.resolve("output/dispensary-prices.json");
const HISTORY_DIR  = path.resolve("output/history");
const PUBLIC_DIR   = path.resolve("public");
const SITEMAP_PATH = path.join(PUBLIC_DIR, "sitemap.xml");
const BASE_URL     = "https://nycweedprice.org";

// Static extra URLs always included in sitemap
const EXTRA_URLS = [
  { loc: `${BASE_URL}/420-deals/`, priority: "0.9", changefreq: "daily" },
];

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(price) {
  return price != null ? `$${Number(price).toFixed(0)}` : "—";
}

// Load all history files and build {slug -> [{date, price}]} map
async function loadHistory() {
  const map = {};
  let files;
  try { files = await fs.readdir(HISTORY_DIR); } catch { return map; }
  const jsonFiles = files.filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  for (const file of jsonFiles) {
    const date = file.replace(".json", "");
    try {
      const raw = await fs.readFile(path.join(HISTORY_DIR, file), "utf8");
      const stores = JSON.parse(raw);
      for (const s of stores) {
        const slug = slugify(s.name);
        if (!map[slug]) map[slug] = [];
        if (s.cheapestEighthOunce?.price) {
          map[slug].push({ date, price: s.cheapestEighthOunce.price });
        }
      }
    } catch { /* skip bad file */ }
  }
  return map;
}

// Inline SVG sparkline from array of prices
function sparkline(points, width = 80, height = 28) {
  if (points.length < 2) return "";
  const prices = points.map(p => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const xs = prices.map((_, i) => (i / (prices.length - 1)) * width);
  const ys = prices.map(p => height - ((p - min) / range) * (height - 4) - 2);
  const d = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const lastY = ys[ys.length - 1].toFixed(1);
  const lastX = xs[xs.length - 1].toFixed(1);
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="sparkline" aria-hidden="true">
    <path d="${d}" fill="none" stroke="#C8FF00" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${lastX}" cy="${lastY}" r="2.5" fill="#C8FF00"/>
  </svg>`;
}

function renderPriceRows(listings, sizeLabel) {
  if (!listings?.length) return "";
  return listings
    .slice()
    .sort((a, b) => a.price - b.price)
    .map(l => `<tr>
      <td class="size-cell">${esc(sizeLabel)}</td>
      <td class="price-cell">${fmt(l.price)}</td>
      <td class="product-cell">${esc(l.product || "")}</td>
    </tr>`).join("\n");
}

function buildSameAs(store) {
  const urls = [];
  const menuUrl = store.menuUrl || store.menuUrlOverride || "";
  if (menuUrl.includes("weedmaps.com")) urls.push(menuUrl);
  if (store.leaflySlug) urls.push(`https://www.leafly.com/dispensary-info/${store.leaflySlug}`);
  return urls;
}

function generatePage(store, historyPoints, allStores) {
  const slug = slugify(store.name);
  const url  = `${BASE_URL}/dispensaries/${slug}/`;
  const allListings = [
    ...(store.ounceListings        || []),
    ...(store.halfOunceListings    || []),
    ...(store.quarterOunceListings || []),
    ...(store.eighthOunceListings  || []),
  ];
  const cheapEighth = store.cheapestEighthOunce?.price;
  const cheapOz     = store.cheapestOunce?.price;
  const hasData     = allListings.length > 0;

  const title = `${store.name} Weed Prices Today | NYC Dispensary Price Tracker`;
  const cheapEighthStr = cheapEighth ? `Cheapest ⅛ oz: $${cheapEighth}. ` : '';
  const cheapOzStr     = cheapOz     ? `1 oz from $${cheapOz}. `           : '';
  const desc  = `${cheapEighthStr}${cheapOzStr}Today's cannabis flower prices at ${store.name} in ${store.neighborhood || "NYC"} — updated daily. Compare to every other NYC licensed dispensary.`;

  const spark = sparkline(historyPoints);

  const priceTable = hasData ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Size</th><th>Price</th><th>Product</th></tr></thead>
        <tbody>
          ${renderPriceRows(store.ounceListings,        "1 oz"   )}
          ${renderPriceRows(store.halfOunceListings,    "1/2 oz" )}
          ${renderPriceRows(store.quarterOunceListings, "1/4 oz" )}
          ${renderPriceRows(store.eighthOunceListings,  "1/8 oz" )}
        </tbody>
      </table>
    </div>` : `<p class="no-data">No price data available for this location. Check back after the next daily scrape.</p>`;

  const historySection = historyPoints.length >= 2 ? `
    <section class="history-section">
      <h2>Price History <span class="hist-sub">(cheapest ⅛ oz per day)</span></h2>
      <div class="spark-row">
        ${spark}
        <div class="spark-meta">
          <span class="spark-label">7-day low</span>
          <span class="spark-val">${fmt(Math.min(...historyPoints.map(p => p.price)))}</span>
        </div>
        <div class="spark-meta">
          <span class="spark-label">Today</span>
          <span class="spark-val">${fmt(historyPoints.at(-1)?.price)}</span>
        </div>
      </div>
    </section>` : "";

  const menuLink = store.menuUrl || store.menuUrlOverride;

  // Compare nearby
  const neighbors = (allStores || []).filter(
    s => s.name !== store.name && s.neighborhood === store.neighborhood && s.status !== "skipped"
  );
  const nearbySection = neighbors.length ? `
    <section class="nearby-section">
      <h2>Also in ${esc(store.neighborhood)}</h2>
      <ul class="nearby-list">
        ${neighbors.map(n => {
          const nSlug = slugify(n.name);
          const nPrice = n.cheapestEighthOunce?.price;
          return `<li><a href="/dispensaries/${nSlug}/">${esc(n.name)}</a>${nPrice ? ` <span class="nearby-price">⅛ oz from $${nPrice}</span>` : ""}</li>`;
        }).join("\n        ")}
      </ul>
    </section>` : "";

  const sameAs = buildSameAs(store);
  const sameAsJson = sameAs.length ? `,\n    "sameAs": ${JSON.stringify(sameAs)}` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="${esc(url)}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <meta property="og:type" content="website">
  <meta property="og:title" content="${esc(store.name)} Cannabis Prices — nycweedprice.org">
  <meta property="og:description" content="${esc(desc)}">
  <meta property="og:url" content="${esc(url)}">
  <meta property="og:image" content="https://nycweedprice.org/og-image.png">
  <meta name="geo.region" content="US-NY">
  <meta name="geo.placename" content="New York City">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "CannabisDispensary",
    "name": "${esc(store.name)}",
    "description": "Licensed cannabis dispensary in ${esc(store.neighborhood || "New York City")}",
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "${esc(store.address || "")}",
      "addressLocality": "New York",
      "addressRegion": "NY",
      "addressCountry": "US"
    },
    "url": "${esc(url)}",
    "priceRange": "${cheapEighth ? `⅛ oz from $${cheapEighth}` : "$$"}"${menuLink ? `,\n    "menu": "${esc(menuLink)}"` : ""}${sameAsJson}
  }
  </script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": [
      {
        "@type": "Question",
        "name": "What are the current flower prices at ${esc(store.name)}?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "${cheapEighth ? `The cheapest eighth ounce (3.5g) at ${esc(store.name)} is currently $${cheapEighth}. Prices are updated daily from the official menu.` : `Flower prices at ${esc(store.name)} are updated daily. Visit nycweedprice.org for the latest listings.`}"
        }
      },
      {
        "@type": "Question",
        "name": "Where is ${esc(store.name)} located?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "${esc(store.name)} is a licensed cannabis dispensary located at ${esc(store.address || "New York City")}, ${esc(store.neighborhood || "NYC")}."
        }
      },
      {
        "@type": "Question",
        "name": "How do ${esc(store.name)} prices compare to other NYC dispensaries?",
        "acceptedAnswer": {
          "@type": "Answer",
          "text": "nycweedprice.org tracks flower prices at 20+ NYC licensed dispensaries daily. Visit the main page to compare ${esc(store.name)} prices against all other stores in real time."
        }
      }
    ]
  }
  </script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <script>
    (function() {
      const stored = localStorage.getItem('theme');
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      if (stored === 'dark' || (!stored && prefersDark)) document.documentElement.classList.add('dark');
    })();
  </script>
  <style>
    :root {
      --bg:      #F7F5F0; --card:    #FFFFFF; --text:    #1A1A1A;
      --muted:   #6B6B6B; --border:  #E8E4DC; --hero-bg: #0D0D0D;
      --lime:    #C8FF00; --lime-dk: #A3CC00; --radius:  4px;
    }
    html.dark {
      --bg: #111; --card: #1A1A1A; --text: #E8E4DC;
      --muted: #888; --border: #2A2A2A;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Inter', system-ui, sans-serif; font-size: 15px; background: var(--bg); color: var(--text); line-height: 1.6; }
    a { color: inherit; text-decoration: none; }

    .topbar {
      background: var(--hero-bg); padding: 14px 24px;
      display: flex; align-items: center; justify-content: space-between;
    }
    .topbar-brand { font-size: 14px; font-weight: 500; color: #E8E4DC; }
    .topbar-brand .tld { color: var(--lime); }
    .topbar-back { font-size: 12px; color: #666; letter-spacing: .06em; }
    .topbar-back:hover { color: #999; }

    .hero-strip {
      background: var(--hero-bg);
      border-bottom: 1px solid #1A1A1A;
      padding: 32px 24px 28px;
    }
    .hero-inner { max-width: 900px; margin: 0 auto; }
    .store-nbhd { font-size: 11px; font-weight: 500; letter-spacing: .18em; text-transform: uppercase; color: var(--lime); margin-bottom: 8px; }
    .store-name { font-size: clamp(24px, 4vw, 40px); font-weight: 600; color: #F0EDE6; line-height: 1.1; margin-bottom: 6px; }
    .store-address { font-size: 13px; color: #666; margin-bottom: 16px; }
    .price-pills { display: flex; gap: 16px; flex-wrap: wrap; }
    .price-pill { background: #1A1A1A; border: 1px solid #2A2A2A; border-radius: var(--radius); padding: 8px 16px; }
    .price-pill .pl { font-size: 10px; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; color: #555; margin-bottom: 2px; }
    .price-pill .pv { font-size: 18px; font-weight: 600; color: var(--lime); font-variant-numeric: tabular-nums; }
    .menu-link {
      display: inline-block; margin-top: 16px;
      background: var(--lime); color: var(--hero-bg);
      font-size: 12px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase;
      padding: 10px 24px; border-radius: var(--radius); transition: background .15s;
    }
    .menu-link:hover { background: var(--lime-dk); }

    .content { max-width: 900px; margin: 0 auto; padding: 40px 24px; }

    h2 { font-size: 18px; font-weight: 600; margin-bottom: 16px; color: var(--text); }
    .hist-sub { font-size: 13px; font-weight: 400; color: var(--muted); margin-left: 8px; }

    .history-section { margin-bottom: 40px; }
    .spark-row { display: flex; align-items: center; gap: 24px; padding: 16px; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); }
    .sparkline { display: block; }
    .spark-meta { display: flex; flex-direction: column; gap: 2px; }
    .spark-label { font-size: 10px; font-weight: 500; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); }
    .spark-val { font-size: 20px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--text); }

    .table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: var(--radius); }
    table { width: 100%; border-collapse: collapse; background: var(--card); }
    thead th { font-size: 10px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); padding: 10px 14px; text-align: left; border-bottom: 1px solid var(--border); background: var(--card); }
    tbody tr { border-bottom: 1px solid var(--border); }
    tbody tr:last-child { border-bottom: none; }
    tbody tr:hover td { background: var(--bg); }
    tbody td { padding: 12px 14px; vertical-align: middle; }
    .size-cell { font-size: 12px; font-weight: 600; color: var(--muted); white-space: nowrap; width: 70px; }
    .price-cell { font-size: 16px; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; width: 80px; }
    .product-cell { font-size: 13px; color: var(--muted); }

    .no-data { color: var(--muted); font-size: 14px; padding: 24px 0; }

    .nearby-section { margin-top: 40px; padding-top: 32px; border-top: 1px solid var(--border); }
    .nearby-list { list-style: none; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
    .nearby-list li { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 14px; font-size: 13px; }
    .nearby-list a { font-weight: 600; }
    .nearby-list a:hover { color: var(--lime); }
    .nearby-price { color: var(--muted); margin-left: 4px; }

    .back-section { margin-top: 40px; padding-top: 32px; border-top: 1px solid var(--border); }
    .back-link { font-size: 13px; color: var(--muted); }
    .back-link:hover { color: var(--text); }

    footer { background: var(--hero-bg); border-top: 1px solid #1A1A1A; padding: 28px 24px; margin-top: 40px; }
    .footer-inner { max-width: 900px; margin: 0 auto; font-size: 12px; color: #555; }
  </style>
</head>
<body>

<div class="topbar">
  <a href="/" class="topbar-brand">nycweedprice<span class="tld">.org</span></a>
  <a href="/" class="topbar-back">← All Dispensaries</a>
</div>

<div class="hero-strip">
  <div class="hero-inner">
    <div class="store-nbhd">${esc(store.neighborhood || "New York City")}</div>
    <h1 class="store-name">${esc(store.name)} Prices</h1>
    <div class="store-address">${esc(store.address || "")}</div>
    <div class="price-pills">
      ${cheapEighth     ? `<div class="price-pill"><div class="pl">⅛ oz from</div><div class="pv">${fmt(cheapEighth)}</div></div>` : ""}
      ${cheapOz         ? `<div class="price-pill"><div class="pl">1 oz from</div><div class="pv">${fmt(cheapOz)}</div></div>` : ""}
    </div>
    ${menuLink ? `<a href="${esc(menuLink)}" target="_blank" rel="noopener noreferrer" class="menu-link">View Menu ↗</a>` : ""}
  </div>
</div>

<div class="content">
  ${historySection}
  <section>
    <h2>Today's Prices <span style="font-size:12px;font-weight:400;color:#888;margin-left:8px">pre-tax · 13–20% added at register</span></h2>
    ${priceTable}
  </section>
  ${nearbySection}
  <div class="back-section">
    <a href="/" class="back-link">← Compare all NYC dispensaries</a>
  </div>
</div>

<footer>
  <div class="footer-inner">
    Prices scraped daily from official dispensary menus. Pre-tax estimates. 21+ only. Not affiliated with ${esc(store.name)}.
    <br>Data last updated: ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.
  </div>
</footer>

</body>
</html>`;
}

async function run() {
  const raw    = await fs.readFile(PRICES_PATH, "utf8");
  const stores = JSON.parse(raw);
  const history = await loadHistory();

  const slugs = [];

  for (const store of stores) {
    if (store.status === "skipped") continue;
    const slug   = slugify(store.name);
    const outDir = path.join(PUBLIC_DIR, "dispensaries", slug);
    await fs.mkdir(outDir, { recursive: true });
    const html = generatePage(store, history[slug] || [], stores);
    await fs.writeFile(path.join(outDir, "index.html"), html, "utf8");
    slugs.push(slug);
    console.log(`  ✓ /dispensaries/${slug}/`);
  }

  // Update sitemap.xml
  const today = new Date().toISOString().split("T")[0];
  const storeUrls = slugs.map(slug => `  <url>
    <loc>${BASE_URL}/dispensaries/${slug}/</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
    <lastmod>${today}</lastmod>
  </url>`).join("\n");

  const extraUrls = EXTRA_URLS.map(e => `  <url>
    <loc>${e.loc}</loc>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
    <lastmod>${today}</lastmod>
  </url>`).join("\n");

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${BASE_URL}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
    <lastmod>${today}</lastmod>
  </url>
${extraUrls}
${storeUrls}
</urlset>
`;
  await fs.writeFile(SITEMAP_PATH, sitemap, "utf8");
  console.log(`  ✓ sitemap.xml updated (${slugs.length + 1 + EXTRA_URLS.length} URLs)`);
  console.log(`Done. Generated ${slugs.length} sub-pages.`);
}

run().catch(err => { console.error(err); process.exit(1); });
