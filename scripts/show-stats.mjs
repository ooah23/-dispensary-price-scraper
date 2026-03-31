#!/usr/bin/env node
/**
 * show-stats.mjs
 * Reads logs/analytics.jsonl and prints a summary:
 *   - Total requests today
 *   - Total requests this week
 *   - Top 5 referers
 *   - Mobile vs desktop ratio
 *
 * Usage: node scripts/show-stats.mjs
 */

import fs from "node:fs";
import readline from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOG_FILE = path.join(ROOT, "logs", "analytics.jsonl");

// Date helpers (compare by date string YYYY-MM-DD)
function toDateStr(isoTs) {
  return isoTs.slice(0, 10); // "2026-03-28"
}

const now = new Date();
const todayStr = toDateStr(now.toISOString());

// Monday of current week (ISO week starts Monday)
const dayOfWeek = now.getDay(); // 0=Sun
const daysFromMon = (dayOfWeek + 6) % 7;
const weekStart = new Date(now);
weekStart.setDate(now.getDate() - daysFromMon);
weekStart.setHours(0, 0, 0, 0);

function isMobile(ua) {
  return /Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

if (!fs.existsSync(LOG_FILE)) {
  console.log("No analytics log found at logs/analytics.jsonl");
  console.log("The file is created automatically when /api/data is first hit.");
  process.exit(0);
}

let totalToday = 0;
let totalWeek = 0;
let totalAll = 0;
let mobileCount = 0;
let desktopCount = 0;
const refererCounts = new Map();

const rl = readline.createInterface({
  input: fs.createReadStream(LOG_FILE, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

for await (const line of rl) {
  const trimmed = line.trim();
  if (!trimmed) continue;

  let entry;
  try {
    entry = JSON.parse(trimmed);
  } catch {
    continue; // skip malformed lines
  }

  totalAll++;

  const entryDate = toDateStr(entry.ts ?? "");
  if (entryDate === todayStr) totalToday++;

  const entryTime = new Date(entry.ts);
  if (entryTime >= weekStart) totalWeek++;

  // Mobile vs desktop
  if (isMobile(entry.userAgent ?? "")) {
    mobileCount++;
  } else {
    desktopCount++;
  }

  // Referer bucketing — strip query strings, keep origin+path
  let ref = (entry.ref ?? "").trim();
  if (ref) {
    try {
      const u = new URL(ref);
      ref = u.origin + u.pathname; // drop query/hash
    } catch {
      // keep raw if not parseable
    }
    refererCounts.set(ref, (refererCounts.get(ref) ?? 0) + 1);
  } else {
    refererCounts.set("(direct / none)", (refererCounts.get("(direct / none)") ?? 0) + 1);
  }
}

// Top 5 referers
const topRefs = [...refererCounts.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5);

const mobileRatio = totalAll > 0 ? ((mobileCount / totalAll) * 100).toFixed(1) : "0.0";
const desktopRatio = totalAll > 0 ? ((desktopCount / totalAll) * 100).toFixed(1) : "0.0";

console.log("=".repeat(48));
console.log("  NYC Weed Price Tracker — Analytics Summary");
console.log("=".repeat(48));
console.log(`  As of: ${now.toISOString()}`);
console.log("");
console.log(`  Requests today  : ${totalToday}`);
console.log(`  Requests this week: ${totalWeek}`);
console.log(`  All-time total  : ${totalAll}`);
console.log("");
console.log("  Top 5 referers:");
if (topRefs.length === 0) {
  console.log("    (no data yet)");
} else {
  for (const [ref, count] of topRefs) {
    console.log(`    ${count.toString().padStart(5)}  ${ref}`);
  }
}
console.log("");
console.log("  Device split:");
console.log(`    Mobile  : ${mobileCount} (${mobileRatio}%)`);
console.log(`    Desktop : ${desktopCount} (${desktopRatio}%)`);
console.log("=".repeat(48));
