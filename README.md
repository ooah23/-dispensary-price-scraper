# NYC Dispensary Price Tracker

A tool that scrapes and displays cannabis product prices from NYC dispensary official storefronts, so you can compare deals across locations in one place.

## What it does

Scrapes product listings and prices from dispensary official storefronts using Playwright, saves the results to `output/`, and serves a local UI for browsing and comparing prices.

## Running locally

**Scrape fresh data:**
```
npm run scrape
```

**Start the UI:**
```
npm run ui
```

The UI is served on the port defined in your `.env` file (default: `4173`). Copy `.env.example` to `.env` to configure it.

## Data sources

Prices are sourced directly from dispensary official storefronts (their own online menus), scraped with [Playwright](https://playwright.dev). No third-party aggregators — data reflects what each dispensary is currently listing.

## Deploying to Railway

1. Push this repo to GitHub.
2. Go to [railway.app](https://railway.app) and create a new project from your GitHub repo.
3. Railway will detect `railway.toml` and build automatically using Nixpacks.
4. Set any required environment variables (see `.env.example`) in the Railway dashboard under **Variables**.
5. The service exposes a health check at `/api/health`.

The `output/` data files are committed to the repo so the deployed site has data to display immediately on boot without needing to run a scrape first.

## Known gotchas / bugs fixed

### Sticky table header overlapping first row in Deals table
**Symptom:** The column header bar in the Best Value Picks table visually overlaps the first data row.

**Root cause:** The global `th` rule sets `position: sticky; top: 56px` (to stick below the 56px nav bar). Inside `.table-scroll` which has `overflow-x: auto`, the browser treats that element as a scroll container. A sticky element inside a scroll container is anchored relative to that container, not the viewport — so `top: 56px` pushes the header 56px *down into* its own container, landing on top of the first data row.

**Fix:** Add `.deals-section .table-scroll th { position: static; }` to disable sticky on the short deals table, which doesn't need it. The main price table is unaffected (same overflow container, but the main table is tall enough that sticky is desirable and the visual overlap is hidden by scroll).

### git push failing from Windows Task Scheduler (SYSTEM account)
**Symptom:** `auto-scrape.bat` scrapes successfully but `git add` fails with "detected dubious ownership".

**Root cause:** The repo is owned by the user account but runs as NT AUTHORITY/SYSTEM. Git refuses to operate on repos it doesn't own.

**Fix:** Add `git config --global --add safe.directory C:/Users/Claudius/dispensary-price-scraper` in `auto-scrape.bat` before the git commands. This runs as SYSTEM and adds the exception to SYSTEM's global git config.

### Playwright browser not found under SYSTEM account
**Symptom:** Task Scheduler runs `node scrape-leafly.mjs` as SYSTEM and Playwright can't find browser executables.

**Root cause:** Playwright browsers are installed under the user profile (`C:\Users\Claudius\AppData\Local\ms-playwright`), which is not visible to the SYSTEM account by default.

**Fix:** Set `PLAYWRIGHT_BROWSERS_PATH=C:\Users\Claudius\AppData\Local\ms-playwright` in `auto-scrape.bat` before calling node.
