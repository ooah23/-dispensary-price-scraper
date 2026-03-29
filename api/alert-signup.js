// api/alert-signup.js — Vercel serverless function
// Accepts POST { email } and appends to logs/alert-signups.jsonl in the project.
// Note: on Vercel, the filesystem is read-only at runtime except for /tmp.
// Emails are written to /tmp/alert-signups.jsonl — use a persistent store
// (Supabase, KV, etc.) once you have >50 signups. For now, log to /tmp and
// print to function logs so signups aren't silently lost.

const fs = require("fs");
const path = require("path");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  let body = "";
  try {
    for await (const chunk of req) body += chunk;
    const { email } = JSON.parse(body);
    if (!email || !EMAIL_RE.test(email)) {
      res.status(400).json({ error: "Invalid email" });
      return;
    }
    const entry = JSON.stringify({ ts: new Date().toISOString(), email }) + "\n";
    // Log to stdout (captured in Vercel function logs)
    console.log("[alert-signup]", entry.trim());
    // Also write to /tmp for same-instance access
    fs.appendFileSync("/tmp/alert-signups.jsonl", entry, "utf8");
  } catch (e) {
    console.error("[alert-signup] error:", e.message);
  }

  res.status(200).json({ ok: true });
};
