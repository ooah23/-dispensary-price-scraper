// api/data.js — Vercel serverless function
// Reads output/dispensary-prices.json (committed to the repo after each local scrape)
// and returns it as JSON with CORS headers and a 5-minute cache.
//
// The scraper runs locally (Playwright can't run on Vercel serverless).
// After each scrape: git add output/dispensary-prices.json && git commit && git push
// Vercel picks up the new file and redeploys automatically.

const fs = require("fs");
const path = require("path");

// Path relative to the project root — Vercel sets cwd to the project root.
const JSON_PATH = path.join(process.cwd(), "output", "dispensary-prices.json");

module.exports = function handler(req, res) {
  // CORS — allow any origin so the static HTML can call this endpoint
  // even if the browser has cached a response from a different origin.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let raw;
  try {
    raw = fs.readFileSync(JSON_PATH, "utf8");
  } catch {
    res.status(404).json({
      error: "No data file found. Run the scraper locally and commit output/dispensary-prices.json."
    });
    return;
  }

  // 5-minute public cache — CDN edge nodes will serve this without hitting
  // the serverless function on every request.
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=60");
  res.status(200).send(raw);
};
