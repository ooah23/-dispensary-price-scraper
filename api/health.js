// api/health.js — Vercel serverless function
// Lightweight liveness check. Returns { ok: true, timestamp } with no caching.
// Useful for uptime monitors (e.g. UptimeRobot) to ping /api/health.

module.exports = function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  res.setHeader("Cache-Control", "no-cache, no-store");
  res.status(200).json({
    ok: true,
    timestamp: new Date().toISOString(),
  });
};
