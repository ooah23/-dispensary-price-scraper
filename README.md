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
