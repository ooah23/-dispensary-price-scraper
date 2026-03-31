import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const PORT = process.env.PORT ?? 4173;
const OUTPUT_DIR = path.resolve("output");
const JSON_PATH = path.join(OUTPUT_DIR, "dispensary-prices.json");
const PUBLIC_DIR = path.resolve("public");
const LOGS_DIR = path.resolve("logs");
const ANALYTICS_LOG = path.join(LOGS_DIR, "analytics.jsonl");
const ALERTS_FILE = path.join(LOGS_DIR, "alert-signups.jsonl");

// Ensure logs directory exists on startup
await fs.mkdir(LOGS_DIR, { recursive: true });

/**
 * Log an API request to logs/analytics.jsonl.
 * IP is truncated to first 3 octets (IPv4) for privacy.
 */
async function logRequest(req) {
  try {
    const rawIp = req.headers["x-forwarded-for"]?.split(",")[0].trim()
      ?? req.socket?.remoteAddress
      ?? "unknown";
    // Keep only first 3 octets for IPv4 (e.g. 1.2.3.4 → 1.2.3.x)
    const ip = rawIp.replace(/^(\d+\.\d+\.\d+)\.\d+$/, "$1.x");
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      ip,
      userAgent: req.headers["user-agent"] ?? "",
      ref: req.headers["referer"] ?? req.headers["referrer"] ?? "",
    });
    await fs.appendFile(ANALYTICS_LOG, entry + "\n", "utf8");
  } catch {
    // Non-fatal — never let logging break the server
  }
}

const MIME = {
  ".html": "text/html",
  ".css":  "text/css",
  ".js":   "application/javascript",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".json": "application/json",
  ".xml":  "text/xml; charset=utf-8",
  ".txt":  "text/plain; charset=utf-8",
};

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Manhattan Dispensary Prices</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; font-size: 14px; background: #f0f0f0; color: #1a1a1a; }

  /* header */
  .header { background: #111; color: #fff; padding: 14px 20px 10px; display: flex; align-items: baseline; gap: 12px; }
  .header h1 { font-size: 17px; font-weight: 700; letter-spacing: -.3px; }
  .header .subtitle { font-size: 12px; color: #aaa; }

  /* stat cards */
  .stats { display: flex; gap: 10px; padding: 14px 20px; flex-wrap: wrap; }
  .stat { background: #fff; border-radius: 8px; padding: 10px 16px; min-width: 130px; box-shadow: 0 1px 3px rgba(0,0,0,.07); }
  .stat-label { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: .4px; margin-bottom: 4px; }
  .stat-value { font-size: 22px; font-weight: 700; line-height: 1; }
  .stat-sub { font-size: 11px; color: #666; margin-top: 3px; }
  .stat-green { color: #059669; }
  .stat-blue  { color: #2563eb; }
  .stat-purple{ color: #7c3aed; }

  /* nav tabs */
  nav { display: flex; gap: 2px; padding: 0 20px 0; border-bottom: 1px solid #ddd; background: #f0f0f0; }
  nav button { padding: 8px 16px; border: none; background: none; cursor: pointer; font-size: 13px; color: #666; border-bottom: 2px solid transparent; margin-bottom: -1px; }
  nav button.active { color: #111; border-bottom-color: #111; font-weight: 600; }
  nav button:hover:not(.active) { color: #333; }

  /* panels */
  .panel { display: none; padding: 16px 20px 40px; }
  .panel.active { display: block; }

  /* filter bar */
  .filterbar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
  .filterbar input[type=text] { padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px; font-size: 13px; width: 240px; background: #fff; }
  .filterbar input[type=text]:focus { outline: none; border-color: #888; }
  .pill-group { display: flex; gap: 4px; }
  .pill { padding: 4px 12px; border: 1px solid #ccc; border-radius: 20px; font-size: 12px; cursor: pointer; background: #fff; user-select: none; }
  .pill.active { background: #111; color: #fff; border-color: #111; }
  .sort-select { padding: 5px 8px; border: 1px solid #ccc; border-radius: 6px; font-size: 12px; background: #fff; cursor: pointer; }
  .result-count { font-size: 12px; color: #888; margin-left: auto; }

  /* table */
  .table-wrap { overflow-x: auto; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  table { width: 100%; border-collapse: collapse; background: #fff; }
  th { background: #111; color: #fff; text-align: left; padding: 8px 12px; font-size: 11px; white-space: nowrap; cursor: pointer; user-select: none; }
  th:hover { background: #333; }
  th.sorted-asc::after  { content: ' ↑'; }
  th.sorted-desc::after { content: ' ↓'; }
  td { padding: 7px 12px; border-bottom: 1px solid #eee; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #fafafa; }

  /* badges */
  .badge { display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 11px; font-weight: 600; }
  .badge-ok   { background: #d1fae5; color: #065f46; }
  .badge-no   { background: #fee2e2; color: #991b1b; }
  .badge-err  { background: #fef3c7; color: #92400e; }
  .badge-skip { background: #e5e7eb; color: #6b7280; }

  /* price / size */
  .price  { font-weight: 700; color: #059669; font-size: 14px; }
  .tag-oz   { background: #dbeafe; color: #1d4ed8; padding: 2px 7px; border-radius: 10px; font-size: 11px; font-weight: 700; }
  .tag-half { background: #ede9fe; color: #6d28d9; padding: 2px 7px; border-radius: 10px; font-size: 11px; font-weight: 700; }
  .store-name { font-weight: 600; }
  .nbhd { color: #888; font-size: 12px; }
  .product-name { max-width: 320px; line-height: 1.35; }
  .note { color: #999; font-size: 11px; max-width: 260px; }

  /* best-price highlight */
  tr.best-oz td   { background: #f0fdf4; }
  tr.best-half td { background: #f5f3ff; }

  .error-msg { color: #dc2626; padding: 20px; }
  .empty { color: #999; padding: 20px; text-align: center; }
</style>
</head>
<body>

<div class="header">
  <h1>Manhattan Dispensary Prices</h1>
  <span class="subtitle" id="subtitle"></span>
</div>

<div class="stats" id="stats"></div>

<nav>
  <button class="active" data-tab="prices">Prices</button>
  <button data-tab="deals">Deals</button>
  <button data-tab="summary">All Stores</button>
</nav>

<!-- PRICES TAB -->
<div id="prices" class="panel active">
  <div class="filterbar">
    <input type="text" id="search" placeholder="Search dispensary or product…" oninput="render()">
    <div class="pill-group" id="sizeFilter">
      <span class="pill active" data-size="all" onclick="setSize(this)">All sizes</span>
      <span class="pill" data-size="1 oz" onclick="setSize(this)">1 oz</span>
      <span class="pill" data-size="1/2 oz" onclick="setSize(this)">½ oz</span>
    </div>
    <div class="pill-group" id="neighborhoodFilter"></div>
    <select class="sort-select" id="sortBy" onchange="render()">
      <option value="price-asc">Price: low → high</option>
      <option value="price-desc">Price: high → low</option>
      <option value="store">Store A–Z</option>
      <option value="size">Size</option>
    </select>
    <span class="result-count" id="resultCount"></span>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th onclick="sortCol('store')">Store</th>
        <th onclick="sortCol('size')">Size</th>
        <th onclick="sortCol('price')">Price</th>
        <th>Product</th>
      </tr></thead>
      <tbody id="priceBody"></tbody>
    </table>
  </div>
</div>

<!-- DEALS TAB -->
<div id="deals" class="panel">
  <div class="table-wrap">
    <table>
      <thead><tr><th>Store</th><th>Neighborhood</th><th>Deal</th></tr></thead>
      <tbody id="dealBody"></tbody>
    </table>
  </div>
</div>

<!-- SUMMARY TAB -->
<div id="summary" class="panel">
  <div class="table-wrap">
    <table>
      <thead><tr>
        <th>Store</th><th>Neighborhood</th><th>Status</th>
        <th>Cheapest oz</th><th>Cheapest ½oz</th><th>Notes</th>
      </tr></thead>
      <tbody id="summaryBody"></tbody>
    </table>
  </div>
</div>

<script>
let data = [];
let activeSizeFilter = 'all';
let activeNeighborhood = 'all';
let sortKey = 'price-asc';

// best prices across all data
let bestOzPrice = Infinity;
let bestHalfPrice = Infinity;

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function statusBadge(s) {
  const map = { ok: 'badge-ok', no_target_sizes: 'badge-no', menu_error: 'badge-err' };
  const label = { ok: 'ok', no_target_sizes: 'no sizes', menu_error: 'error' };
  const cls = map[s] || 'badge-skip';
  return \`<span class="badge \${cls}">\${label[s] || 'skipped'}</span>\`;
}

function setSize(el) {
  document.querySelectorAll('#sizeFilter .pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  activeSizeFilter = el.dataset.size;
  render();
}

function setNeighborhood(el) {
  document.querySelectorAll('#neighborhoodFilter .pill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  activeNeighborhood = el.dataset.nbhd;
  render();
}

function sortCol(key) {
  if (sortKey === key + '-asc') sortKey = key + '-desc';
  else sortKey = key + '-asc';
  document.getElementById('sortBy').value = sortKey.startsWith('price') ? sortKey : sortKey;
  render();
}

function buildRows() {
  const q = document.getElementById('search').value.toLowerCase();
  const sort = document.getElementById('sortBy').value;
  sortKey = sort;

  const rows = [];
  for (const d of data) {
    const listings = [...(d.ounceListings || []), ...(d.halfOunceListings || [])];
    for (const l of listings) {
      if (activeSizeFilter !== 'all' && l.size !== activeSizeFilter) continue;
      if (activeNeighborhood !== 'all' && d.neighborhood !== activeNeighborhood) continue;
      if (q && !d.name.toLowerCase().includes(q) && !(l.product||'').toLowerCase().includes(q) && !(d.neighborhood||'').toLowerCase().includes(q)) continue;
      rows.push({ store: d.name, neighborhood: d.neighborhood, size: l.size, price: l.price, product: l.product });
    }
  }

  rows.sort((a, b) => {
    if (sort === 'price-asc')  return a.price - b.price;
    if (sort === 'price-desc') return b.price - a.price;
    if (sort === 'store')      return a.store.localeCompare(b.store);
    if (sort === 'store-desc') return b.store.localeCompare(a.store);
    if (sort === 'size')       return a.size.localeCompare(b.size) || a.price - b.price;
    if (sort === 'size-desc')  return b.size.localeCompare(a.size) || a.price - b.price;
    return a.price - b.price;
  });

  return rows;
}

function render() {
  const rows = buildRows();
  document.getElementById('resultCount').textContent = rows.length + ' listing' + (rows.length !== 1 ? 's' : '');

  if (!rows.length) {
    document.getElementById('priceBody').innerHTML = '<tr><td colspan="4" class="empty">No listings match filters</td></tr>';
    return;
  }

  document.getElementById('priceBody').innerHTML = rows.map(r => {
    const sizeTag = r.size === '1 oz'
      ? '<span class="tag-oz">1 oz</span>'
      : '<span class="tag-half">½ oz</span>';
    const isBestOz   = r.size === '1 oz'   && r.price === bestOzPrice;
    const isBestHalf = r.size === '1/2 oz' && r.price === bestHalfPrice;
    const rowClass   = isBestOz ? 'best-oz' : isBestHalf ? 'best-half' : '';
    const star = (isBestOz || isBestHalf) ? ' ★' : '';
    return \`<tr class="\${rowClass}">
      <td><div class="store-name">\${esc(r.store)}\${star}</div><div class="nbhd">\${esc(r.neighborhood)}</div></td>
      <td>\${sizeTag}</td>
      <td class="price">$\${r.price.toFixed(2)}</td>
      <td class="product-name">\${esc(r.product)}</td>
    </tr>\`;
  }).join('');
}

function renderDeals() {
  const rows = [];
  for (const d of data) {
    if (!d.deals?.length) continue;
    for (const deal of d.deals) {
      rows.push(\`<tr>
        <td><div class="store-name">\${esc(d.name)}</div></td>
        <td class="nbhd">\${esc(d.neighborhood)}</td>
        <td>\${esc(deal)}</td>
      </tr>\`);
    }
  }
  document.getElementById('dealBody').innerHTML = rows.join('') || '<tr><td colspan="3" class="empty">No deals found</td></tr>';
}

function renderSummary() {
  document.getElementById('summaryBody').innerHTML = data.map(d => {
    const oz   = d.cheapestOunce   ? \`<strong>$\${d.cheapestOunce.price.toFixed(2)}</strong> <span class="note">\${esc(d.cheapestOunce.product)}</span>\`   : '<span class="note">—</span>';
    const half = d.cheapestHalfOunce ? \`<strong>$\${d.cheapestHalfOunce.price.toFixed(2)}</strong> <span class="note">\${esc(d.cheapestHalfOunce.product)}</span>\` : '<span class="note">—</span>';
    return \`<tr>
      <td class="store-name">\${esc(d.name)}</td>
      <td class="nbhd">\${esc(d.neighborhood)}</td>
      <td>\${statusBadge(d.status)}</td>
      <td>\${oz}</td>
      <td>\${half}</td>
      <td class="note">\${esc(d.sourceNote || (d.status !== 'ok' ? d.error || '' : ''))}</td>
    </tr>\`;
  }).join('');
}

function buildStats() {
  const okStores = data.filter(d => d.status === 'ok');
  const allOz    = data.flatMap(d => d.ounceListings || []);
  const allHalf  = data.flatMap(d => d.halfOunceListings || []);

  bestOzPrice   = allOz.length   ? Math.min(...allOz.map(l => l.price))   : Infinity;
  bestHalfPrice = allHalf.length ? Math.min(...allHalf.map(l => l.price)) : Infinity;

  const cheapestOzItem   = allOz.find(l => l.price === bestOzPrice);
  const cheapestHalfItem = allHalf.find(l => l.price === bestHalfPrice);
  const cheapestOzStore  = data.find(d => (d.ounceListings||[]).includes(cheapestOzItem));
  const cheapestHalfStore= data.find(d => (d.halfOunceListings||[]).includes(cheapestHalfItem));

  document.getElementById('stats').innerHTML = \`
    <div class="stat">
      <div class="stat-label">Stores with prices</div>
      <div class="stat-value stat-green">\${okStores.length}</div>
      <div class="stat-sub">of \${data.length} total</div>
    </div>
    <div class="stat">
      <div class="stat-label">1 oz listings</div>
      <div class="stat-value stat-blue">\${allOz.length}</div>
      <div class="stat-sub">\${okStores.filter(d=>(d.ounceListings||[]).length>0).length} stores</div>
    </div>
    <div class="stat">
      <div class="stat-label">½ oz listings</div>
      <div class="stat-value stat-purple">\${allHalf.length}</div>
      <div class="stat-sub">\${okStores.filter(d=>(d.halfOunceListings||[]).length>0).length} stores</div>
    </div>
    \${bestOzPrice < Infinity ? \`
    <div class="stat">
      <div class="stat-label">Cheapest oz</div>
      <div class="stat-value stat-green">$\${bestOzPrice.toFixed(2)}</div>
      <div class="stat-sub">\${esc(cheapestOzStore?.name || '')}</div>
    </div>\` : ''}
    \${bestHalfPrice < Infinity ? \`
    <div class="stat">
      <div class="stat-label">Cheapest ½ oz</div>
      <div class="stat-value stat-purple">$\${bestHalfPrice.toFixed(2)}</div>
      <div class="stat-sub">\${esc(cheapestHalfStore?.name || '')}</div>
    </div>\` : ''}
  \`;
}

function buildNeighborhoodFilter() {
  const hoods = [...new Set(
    data.filter(d => d.status === 'ok').map(d => d.neighborhood).filter(Boolean)
  )].sort();
  const container = document.getElementById('neighborhoodFilter');
  container.innerHTML = [
    '<span class="pill active" data-nbhd="all" onclick="setNeighborhood(this)">All areas</span>',
    ...hoods.map(h => \`<span class="pill" data-nbhd="\${esc(h)}" onclick="setNeighborhood(this)">\${esc(h)}</span>\`)
  ].join('');
}

// tab switching
document.querySelectorAll('nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

fetch('/api/data')
  .then(r => r.json())
  .then(json => {
    if (json.error) {
      document.body.innerHTML = '<p class="error-msg">' + esc(json.error) + '</p>';
      return;
    }
    data = json;
    const ok = data.filter(d => d.status === 'ok').length;
    document.getElementById('subtitle').textContent = \`\${data.length} dispensaries · \${ok} with prices\`;
    buildStats();
    buildNeighborhoodFilter();
    render();
    renderDeals();
    renderSummary();
  })
  .catch(() => {
    document.body.innerHTML = '<p class="error-msg">Failed to load data. Run the scraper first.</p>';
  });
</script>
</body>
</html>`;

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://0.0.0.0:${PORT}`);
  const { pathname } = url;

  // Handle CORS preflight for /api/* routes
  if (pathname.startsWith("/api/") && req.method === "OPTIONS") {
    setCorsHeaders(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // /api/health — checks data freshness, not just process liveness
  if (pathname === "/api/health") {
    setCorsHeaders(res);
    try {
      const metaPath = path.join(OUTPUT_DIR, "metadata.json");
      const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
      const scrapedAt = meta.scrapedAt ? new Date(meta.scrapedAt) : null;
      const ageHours = scrapedAt ? (Date.now() - scrapedAt.getTime()) / 3600000 : Infinity;
      const stale = ageHours > 36; // >36h since last scrape = stale
      const status = stale ? 503 : 200;
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      res.end(JSON.stringify({
        ok: !stale,
        timestamp: new Date().toISOString(),
        scrapedAt: meta.scrapedAt ?? null,
        dataAgeHours: Math.round(ageHours * 10) / 10,
        okStores: meta.okStores ?? null,
        totalStores: meta.totalStores ?? null,
        stale,
      }));
    } catch {
      res.writeHead(503, { "Content-Type": "application/json", "Cache-Control": "no-cache" });
      res.end(JSON.stringify({ ok: false, error: "metadata unavailable", timestamp: new Date().toISOString() }));
    }
    return;
  }

  // /api/alert-signup  (POST)
  if (pathname === "/api/alert-signup" && req.method === "POST") {
    setCorsHeaders(res);
    try {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { email } = JSON.parse(body);
      if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        const entry = JSON.stringify({ ts: new Date().toISOString(), email }) + "\n";
        await fs.appendFile(ALERTS_FILE, entry, "utf8");
      }
    } catch { /* non-fatal */ }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // /api/data
  if (pathname === "/api/data") {
    setCorsHeaders(res);
    logRequest(req); // fire-and-forget analytics log
    try {
      const raw = await fs.readFile(JSON_PATH, "utf8");
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=300" });
      res.end(raw);
    } catch {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "No data file found. Run the scraper first: node scrape-leafly.mjs" }));
    }
    return;
  }

  // GET / — serve public/index.html if it exists, otherwise 404
  if (pathname === "/") {
    const indexPath = path.join(PUBLIC_DIR, "index.html");
    try {
      const html = await fs.readFile(indexPath, "utf8");
      res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
      res.end(html);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found: public/index.html does not exist");
    }
    return;
  }

  // GET /dashboard — internal dashboard
  if (pathname === "/dashboard") {
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
    res.end(HTML);
    return;
  }

  // Static files from public/
  if (pathname.startsWith("/")) {
    const filePath = path.join(PUBLIC_DIR, pathname);
    // Prevent path traversal outside PUBLIC_DIR
    if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    try {
      const data = await fs.readFile(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME[ext] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": contentType });
      res.end(data);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`UI running at http://0.0.0.0:${PORT}`);
  console.log(`  Public site: http://localhost:${PORT}/`);
  console.log(`  Dashboard:   http://localhost:${PORT}/dashboard`);
  console.log(`  API data:    http://localhost:${PORT}/api/data`);
  console.log(`  API health:  http://localhost:${PORT}/api/health`);
});
