# Storefront Addition & Filtering Guide

Reference for evaluating and adding new NYC dispensary storefronts to `dispensaries.mjs`.

---

## Quick Vetting Checklist

Before adding any store, confirm all of the following:

- [ ] Store is a licensed NY dispensary (not gray market)
- [ ] Menu page loads in a normal browser with visible products and prices
- [ ] Flower is sold in bulk sizes (1/8, 1/4, 1/2, or 1 oz) — not pre-rolls or gummies only
- [ ] Menu is NOT behind a required account login or membership wall
- [ ] Store has a Manhattan (or target-borough) address
- [ ] You can identify the menu platform (see Provider Detection below)
- [ ] A test scrape returns ≥ 5 flower products

**Skip stores where:**
- Menu only shows pre-rolls or accessories
- Menu is a PDF or static image
- Site returns 403/Cloudflare block on every automated visit
- All pricing requires clicking into individual product pages (no list view)

---

## Provider Detection

Inspect the menu URL and page source to identify the platform:

| Signal | Provider | Notes |
|---|---|---|
| `hwcannabis.co`, `thetravelagency.co` (Blaze URLs) | `blaze` | Official brand storefronts |
| `dutchie.com/embedded-menu/[slug]` | `dutchie` | Use embedded URL only (see below) |
| `dazed.fun`, `verdicannabis.com`, `getsmacked.online`, `greengeniusnyc.com` | `joint` | Joint/Dutchie Plus SPAs |
| `newamsterdam.nyc/store/` | `newamsterdam` | Dispense app platform (170+ products) |
| `shop.newamsterdam.nyc` | `newamsterdam` | Mosaic platform (legacy — 12 products only) |
| `weedmaps.com/dispensaries/[slug]/menu` | `weedmaps` | Weedmaps hosted menu |
| `conbud.com/stores/[slug]/products/flower` | `conbud` | CONBUD custom storefront |
| `gotham.nyc/menu/` | `gotham` | Gotham custom platform |
| `kushklub.com/nyc` or `menu.kushklub.com` | `kushklub` | KushKlub custom |
| `[brand].com/shop-cannabis-flower` (WooCommerce) | `woocommerce` | WordPress/WooCommerce stores |
| `leafly.com/dispensary-info/[slug]` | `leafly` | **Info-only for most NYC stores — 0 products likely** |
| Dutchie GraphQL calls to `api.dutchie.com` | `dutchie` | Check Network tab |
| `api.mosaic.green` in Network tab | `newamsterdam` | Even if custom domain |
| `joint-ecommerce/v1` in Network tab | `joint` | Joint SPA backend |

### How to confirm the platform

1. Open browser DevTools → Network tab → filter `XHR/Fetch`
2. Load the menu page and look for API calls
3. Match the API domain against the table above

---

## Provider-Specific URL Rules

### Blaze (`hwcannabis.co`, `thetravelagency.co`)
```js
menuUrlOverride: "https://hwcannabis.co/menu/[location]/categories/flower/"
dealsUrlOverride: "https://hwcannabis.co/menu/[location]/specials/"
```
- Always use the **location-specific** menu path, not the chain root
- The `/categories/flower/` suffix is required — the root menu includes all product types
- Chain-wide menus (like Travel Agency) work fine if there's only one NYC location

### Dutchie (embedded menus)
```js
menuUrlOverride: "https://dutchie.com/embedded-menu/[slug]"
dealsUrlOverride: null
```
- **Always use `/embedded-menu/[slug]`** — NOT `/dispensary/[slug]/categories/flower`
- **Do NOT append `/categories/flower`** — returns 404 on embedded menus
- Find the slug from the brand's website source or Dutchie's directory
- The root embed URL loads all categories; the scraper filters for flower internally

### Joint / Dutchie Plus SPAs
```js
menuUrlOverride: "https://[brand].com/stores/[slug]/products/flower"
// OR
menuUrlOverride: "https://[brand].com/categories/flower/"
```
- These sites look like Dutchie but use a different backend (`joint-ecommerce/v1`)
- `greengeniusnyc.com` is a Dutchie Plus SPA — use `joint` provider, NOT `dutchie`
- The scraper has a body-text fallback if the API is blocked; 50+ products should still appear
- If a brand site returns 403 (e.g., VERDI), the URL may still be Google-indexed and scraper may use body-text fallback — include it but note the risk

### New Amsterdam / Mosaic
```js
menuUrlOverride: "https://shop.newamsterdam.nyc/"
dealsUrlOverride: "https://shop.newamsterdam.nyc/"   // /specials/ is a 404 — use shop root
```
- Mosaic intercepts `api.mosaic.green/…product-list` API calls
- **Price field semantics**: `variant.price` = ORIGINAL/full price; `variant.discounted_price` = sale price (null when no deal). Always prefer `discounted_price ?? price` for the displayed price.
- **Deal detection**: check `variant.discounted_price != null && discounted_price < price`
- **`/specials/` URL is a dead 404** — deals are captured from the main flower product-list (same API, discounted products have `discounted_price` set)
- Deals are populated via `mosaicDealsCache` during the main menu scrape — `extractNewAmsterdamDeals` reads from cache, no re-navigation
- The scraper clicks the "Flower" category button to trigger the flower-specific API call
- Age gate is handled automatically
- For deals/specials: the specials page uses the **same** `product-list` endpoint — do not filter by URL keyword

### Weedmaps
```js
menuUrlOverride: "https://weedmaps.com/dispensaries/[slug]/menu"
```
- Use the **base `/menu` path** — NOT a deep product URL like `/menu/moonlight-[uuid]`
- Deep URLs point to single-product detail pages, not the menu list
- Find the slug from the Weedmaps listing URL

### CONBUD
```js
menuUrlOverride: "https://conbud.com/stores/[slug]/products/flower"
dealsUrlOverride: "https://conbud.com/stores/[slug]/specials"
```
- Scraper uses weight-filter selectors specific to the CONBUD storefront
- Only works for CONBUD-branded stores

### Leafly (⚠️ Caution)
```js
leaflySlug: "store-slug-here"
// Do NOT set menuUrlOverride
```
- Leafly slugs are valid for store metadata (address, hours) but **NYC licensed dispensaries rarely expose product menus via Leafly's API**
- Expected result for most NYC stores: `status: ok` but `0` products across all size buckets
- Only add a `leaflySlug` if the Leafly listing shows real flower products with prices in your browser
- Prefer the store's own storefront URL over Leafly whenever possible

---

## `dispensaries.mjs` Entry Template

```js
{
  name: "Store Name",
  address: "123 Example St",
  neighborhood: "Neighborhood",
  menuUrlOverride: "https://...",   // required (or use leaflySlug)
  dealsUrlOverride: null,           // set URL if specials page exists, otherwise null
  sourceNote: "Provider name — brief scraper note"
}
```

For Leafly-only stores:
```js
{
  name: "Store Name",
  address: "123 Example St",
  neighborhood: "Neighborhood",
  leaflySlug: "store-slug",
  sourceNote: "Leafly storefront — may return 0 products if menu not synced"
}
```

---

## Diagnosing a Store Returning 0 Products

Work through in order:

1. **Wrong URL pattern** — Is it `/embedded-menu/slug` (Dutchie) vs `/dispensary/slug/categories/flower`? Check Provider Rules above.
2. **Wrong provider** — Does `urlProvider()` map this URL to the right extractor? Add a URL pattern match in `urlProvider()` if needed.
3. **Deep product page** — URL points to a single item, not the menu list (common on Weedmaps and WooCommerce).
4. **Age gate not dismissed** — Try adding the site to the age-gate click list in the relevant extractor.
5. **Cloudflare / bot protection** — Site returns 403. Check if body text fallback yields results; if not, the store cannot be scraped reliably.
6. **Leafly info-only** — No menu data exposed. Switch to the store's own storefront URL.
7. **Size not detected** — Product names don't include weight strings (`3.5g`, `28g`, `1/8 oz`, etc.). The `detectSize()` function will skip them. Check the actual product names on the live site.
8. **API intercepted too early** — Response handler was registered after page navigation. Always attach `page.on("response", handler)` before `gotoWithRetries()`.

---

## Deals / Specials Scraping Rules

- **Never filter intercepted API responses by URL keywords** like `special|promo|deal|discount` — most platforms (Blaze, Mosaic, Joint) use the same `product-list` endpoint for their specials page
- Navigate to the specials page URL, then intercept ALL `product-list` / `catalog` API calls — the platform filters by "specials" server-side, so whatever comes back IS the deals inventory
- For structured deal data, capture **both** price fields from the API variant:
  - `variant.price` — current (discounted) price
  - `variant.compare_at_price` OR `variant.base_price` OR `variant.original_price` — original price
- A deal exists when `originalPrice > currentPrice`
- Body-text fallback for deals is unreliable — use it only when the API yields nothing

---

## NYC Expansion Priority (as of 2026-03)

High-value neighborhoods currently unserved or underserved:

| Neighborhood | Notes |
|---|---|
| East Village / LES | Only KushKlub and CONBUD; room for 1–2 more |
| Midtown | Smiley Exotics only; high foot-traffic |
| Upper East Side | No stores currently tracked |
| Brooklyn (Williamsburg, Park Slope) | Not yet in scope |
| Harlem | Not yet in scope |

When evaluating expansion stores, prefer stores with:
1. Their own branded storefront (not just Leafly/Weedmaps)
2. Visible bulk flower (oz, half oz) on the menu
3. Active specials/deals page
4. Good Google reviews (signals legitimacy + traffic)

---

## Failure Patterns to Avoid

| Anti-pattern | What Happens | Fix |
|---|---|---|
| Dutchie `/dispensary/[slug]/categories/flower` | 404 on embedded menus | Use `/embedded-menu/[slug]` |
| Appending `/categories/flower` to embedded Dutchie URLs | 404 | Use root embed URL |
| Weedmaps `/menu/[uuid]` deep link | Single product page, 0 products | Use `/menu` base path |
| Using `dutchie` provider for Joint/Dutchie Plus SPAs | GraphQL blocked by Cloudflare, 0 products | Use `joint` provider |
| Leafly slug for a store without a Leafly product menu | 0 products | Use the store's own URL |
| Filtering deals API responses by keyword | Misses all deals (Mosaic, Blaze, Joint all use same endpoint) | Intercept all `product-list` calls |
| Registering API response handler after `goto()` | Misses responses that fire during page load | Always register before navigation |
| Including a store with only pre-rolls / accessories | Inflates store count, confuses users | Skip until bulk flower is stocked |
