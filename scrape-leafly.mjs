import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { dispensaries } from "./dispensaries.mjs";

const OUTPUT_DIR = path.resolve("output");
const HISTORY_DIR = path.join(OUTPUT_DIR, "history");
const JSON_PATH = path.join(OUTPUT_DIR, "dispensary-prices.json");
const METADATA_PATH = path.join(OUTPUT_DIR, "metadata.json");
const PRICE_CSV_PATH = path.join(OUTPUT_DIR, "dispensary-prices.csv");
const DEALS_CSV_PATH = path.join(OUTPUT_DIR, "dispensary-deals.csv");

const SIZE_PATTERNS = [
  { label: "1 oz", regex: /\b(?:1\s*ounce|1\s*oz|1oz|28g|28\s*g|28(?:\.0+)?\s*grams?)\b/i },
  { label: "1/2 oz", regex: /\b(?:1\/2\s*ounce|1\/2\s*oz|1\/2oz|14g|14\s*g|14(?:\.0+)?\s*grams?|half\s*ounce|0\.5\s*oz)\b/i },
  { label: "1/4 oz", regex: /\b(?:1\/4\s*ounce|1\/4\s*oz|1\/4oz|quarter\s*ounce|(?<![.\d])7g|(?<![.\d])7\s*g|(?<![.\d])7(?:\.0+)?\s*grams?)\b/i },
  { label: "1/8 oz", regex: /\b(?:1\/8\s*ounce|1\/8\s*oz|1\/8oz|eighth\s*ounce|3\.5g|3\.5\s*g|3\.5(?:0+)?\s*grams?)\b/i }
];

function detectSize(text) {
  for (const pattern of SIZE_PATTERNS) {
    if (pattern.regex.test(text)) {
      return pattern.label;
    }
  }
  return null;
}

function isPreGround(name) {
  return /pre[- ]?ground|infused\s+ground|kief[- ]infused|infused\s+pre[- ]?ground/i.test(name ?? "");
}

function storeUrl(slug) {
  return `https://www.leafly.com/dispensary-info/${slug}`;
}

function flowerMenuUrl(slug) {
  return `${storeUrl(slug)}/menu?product_category[]=Flower`;
}

function dealsUrl(slug) {
  return `${storeUrl(slug)}/deals`;
}

function urlProvider(url) {
  if (!url) {
    return "unknown";
  }
  if (url.includes("weedmaps.com")) {
    return "weedmaps";
  }
  if (url.includes("shop.newamsterdam.nyc") || url.includes("newamsterdam.nyc")) {
    return "newamsterdam";
  }
  if (url.includes("conbud.com")) {
    return "conbud";
  }
  if (url.includes("gotham.nyc")) {
    return "gotham";
  }
  if (url.includes("shop.kushklub.com") || url.includes("menu.kushklub.com")) {
    return "kushklub";
  }
  if (url.includes("hwcannabis.co") || url.includes("thetravelagency.co")) {
    return "blaze";
  }
  if (url.includes("dazed.fun") || url.includes("verdicannabis.com") || url.includes("getsmacked.online") || url.includes("greengeniusnyc.com")) {
    return "joint";
  }
  if (url.includes("blueforestfarmsdispensary.com")) {
    return "woocommerce";
  }
  if (url.includes("leafly.com")) {
    return "leafly";
  }
  if (
    url.includes("dutchie.com") ||
    url.includes("dtche%5B") ||
    url.includes("dtche[")
  ) {
    return "dutchie";
  }
  return "generic";
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, " ");
}

function parseMoney(line) {
  const match = line.match(/\$([0-9]+(?:\.[0-9]{2})?)/);
  return match ? Number(match[1]) : null;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function cleanText(value) {
  return normalizeWhitespace(decodeEntities(stripTags(value ?? "")));
}

async function gotoWithRetries(page, url, options = {}) {
  const { attempts = 3, timeout = 60000, waitUntil = "domcontentloaded" } = options;

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil, timeout });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await page.waitForTimeout(1500 * attempt);
      }
    }
  }

  throw lastError;
}

async function acceptWeedmapsAgeGate(page) {
  const yesButton = page.getByText(/Yes, let me in!?/i).first();
  try {
    if (await yesButton.isVisible({ timeout: 1500 })) {
      await yesButton.click();
      await page.waitForTimeout(1500);
    }
  } catch {
    // No age gate present.
  }
}

async function acceptBlazeAgeGate(page) {
  const pickupButton = page.getByText(/Yes! Shop store pick-up/i).first();
  const yesButton = page.getByText(/^Yes$/i).first();

  try {
    if (await pickupButton.isVisible({ timeout: 1200 })) {
      await pickupButton.click();
      await page.waitForTimeout(1500);
    } else if (await yesButton.isVisible({ timeout: 1200 })) {
      await yesButton.click();
      await page.waitForTimeout(1500);
    }
  } catch {
    // No age gate present.
  }
}

async function waitForWeedmapsListings(page) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const count = await page.locator('li[class*="ListingItemContainer"]').count();
    if (count > 0) {
      return count;
    }
    await page.waitForTimeout(1200);
  }
  return 0;
}

function findPreviousLabel(lines, startIndex) {
  const parts = [];
  for (let offset = 1; offset <= 6; offset += 1) {
    const line = lines[startIndex - offset];
    if (!line) {
      continue;
    }
    if (/\$[0-9]/.test(line)) {
      continue;
    }
    if (/add to cart/i.test(line)) {
      continue;
    }
    if (/^(flower|pre-roll|concentrate|edible|cartridge|topical|accessory|other)$/i.test(line)) {
      continue;
    }
    if (/^(sativa|indica|hybrid|sativa-hybrid|indica-hybrid|sativa dominant|indica dominant)$/i.test(line)) {
      continue;
    }
    if (/\d+(?:\.\d+)?%|^(?:thc|cbd|tac)[\s:]/i.test(line)) {
      continue;
    }
    // If this line already contains a part we collected, or vice versa, take the longer one and stop
    const subsumed = parts.findIndex((p) => line.includes(p) || p.includes(line));
    if (subsumed !== -1) {
      if (line.length > parts[subsumed].length) {
        parts[subsumed] = line;
      }
      break;
    }
    parts.unshift(line);
    if (parts.length >= 2) {
      break;
    }
  }
  // If any collected part is already a pipe-delimited full title, prefer it alone
  const pipePart = parts.find((p) => p.includes("|"));
  if (pipePart) {
    return normalizeWhitespace(pipePart);
  }
  return normalizeWhitespace(parts.join(" "));
}

function extractDeals(text) {
  if (!text) {
    return [];
  }

  if (/isn.?t sharing any deals right now/i.test(text)) {
    return [];
  }

  const lines = text
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const start = lines.findIndex((line) => /current dispensary deals near you/i.test(line));
  if (start !== -1) {
    const deals = [];
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^promotions$/i.test(line) || /^disclaimer$/i.test(line)) {
        break;
      }
      if (/^(available today|get high for less\.|order these limited-time deals)/i.test(line)) {
        continue;
      }
      deals.push(line);
    }

    return deals;
  }

  const weedmapsDealIndices = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^deals$/i.test(line) || /^## deals$/i.test(line))
    .map(({ index }) => index);

  if (weedmapsDealIndices.length > 0) {
    const weedmapsStart = weedmapsDealIndices[weedmapsDealIndices.length - 1];
    const deals = [];
    for (let i = weedmapsStart + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (/^(menu|store details|reviews|about)$/i.test(line) || /^## /.test(line)) {
        break;
      }
      if (
        /^(view all|deals|shop|delivery|dispensaries|brands|products|learn|strains|home|united states|new york|new york city|dispensary|order online|in-store purchases only|recreational|supports the black community|storefront \| pickup|claim this dispensary)$/i.test(line)
      ) {
        continue;
      }
      if (/^\(?\d+ ratings? \| \d+ reviews?\)?$/i.test(line) || /^4\.\d$/.test(line) || /^Â·$/.test(line)) {
        continue;
      }
      deals.push(line);
    }
    return deals;
  }

  return [];
}

function extractPriceEntries(text) {
  const lines = text
    .split("\n")
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  const entries = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // Skip "Add 1 oz to cart" / "Add to cart" lines entirely
    if (/add\s+(?:[\d./]+\s*(?:oz|g)\s+)?to\s+cart/i.test(line)) {
      continue;
    }

    const size = detectSize(line);
    if (!size) {
      continue;
    }

    let price = null;
    for (let offset = 0; offset <= 8; offset += 1) {
      const candidate = lines[i + offset];
      if (!candidate) {
        continue;
      }
      price = parseMoney(candidate);
      if (price !== null) {
        break;
      }
      if (/add to cart/i.test(candidate)) {
        break;
      }
    }

    if (price === null) {
      for (let offset = -1; offset >= -4; offset -= 1) {
        const candidate = lines[i + offset];
        if (!candidate) {
          continue;
        }
        if (/add to cart/i.test(candidate)) {
          break;
        }
        price = parseMoney(candidate);
        if (price !== null) {
          break;
        }
      }
    }

    if (price === null) {
      for (let offset = -4; offset <= 4; offset += 1) {
      const candidate = lines[i + offset];
      if (!candidate) {
        continue;
      }
      price = parseMoney(candidate);
      if (price !== null) {
        break;
      }
    }
    }

    if (price === null) {
      continue;
    }

    const trimmed = line.trim();
    const isSizeOnlyLine = SIZE_PATTERNS.some((p) => {
      const m = trimmed.match(p.regex);
      return m && m[0].length === trimmed.length;
    });
    const lineHasPrice = parseMoney(line) !== null;
    const product = (isSizeOnlyLine || lineHasPrice) ? findPreviousLabel(lines, i) : normalizeWhitespace(line);

    entries.push({
      size,
      price,
      line,
      product,
      preGround: isPreGround(product) || isPreGround(line)
    });
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const price = parseMoney(line);
    if (price === null) {
      continue;
    }

    for (const size of SIZE_PATTERNS) {
      if (!size.regex.test(line)) {
        continue;
      }

      const product = findPreviousLabel(lines, i);
      entries.push({
        size: size.label,
        price,
        line,
        product,
        preGround: isPreGround(product) || isPreGround(line)
      });
    }
  }

  return entries;
}

function parseWeedmapsCardText(rawText) {
  const text = normalizeWhitespace(
    decodeEntities(stripTags(rawText))
      .replace(/Add to cart/gi, " ")
      .replace(/\d+(?:\.\d+)?\s*star average rating from \d+ reviews?/gi, " ")
      .replace(/\b\d+(?:\.\d+)?\(\d+\)\b/g, " ")
  );

  const price = parseMoney(text);
  const size = detectSize(text);
  if (price === null || !size) {
    return null;
  }

  const beforePrice = text.split(/\$[0-9]/)[0] ?? text;
  const beforePotency = beforePrice.split(/\d+(?:\.\d+)?%\s*THC/i)[0] ?? beforePrice;
  const product = normalizeWhitespace(
    beforePotency.replace(/^(?:Featured\s*)?(?:BIG BUDS|SMALLS|FLOWER|GROUND|INFUSED|CANNABIS FLOWER|WHOLE FLOWER)+/i, "")
  );

  const cleanProduct = cleanText(product || size);
  return {
    size,
    price,
    line: text,
    product: cleanProduct,
    preGround: isPreGround(cleanProduct) || isPreGround(text)
  };
}

function parseNewAmsterdamProductText(text) {
  const clean = cleanText(text);
  const price = parseMoney(clean);
  const size = detectSize(clean);
  if (price === null || !size) {
    return null;
  }

  let product = clean.replace(/^\$[0-9]+(?:\.[0-9]{2})?\s*/, "");
  product = product.split(/\d+(?:\.\d+)?%\s*THC/i)[0] ?? product;
  product = normalizeWhitespace(product);

  const cleanProduct = cleanText(product || size);
  return {
    size,
    price,
    line: clean,
    product: cleanProduct,
    preGround: isPreGround(cleanProduct) || isPreGround(clean)
  };
}

function normalizeDealLabel(text, dispensaryName = "") {
  let value = cleanText(text)
    .replace(/^Featured/i, "")
    .replace(/^Deals$/i, "")
    .trim();

  if (!value) {
    return "";
  }

  if (dispensaryName) {
    const index = value.toLowerCase().indexOf(dispensaryName.toLowerCase());
    if (index > 0) {
      value = value.slice(0, index).trim();
    }
  }

  value = value
    .replace(/\b\d(?:\.\d)?\s*stars?.*$/i, "")
    .replace(/\|\s*(Pickup|Delivery).*$/i, "")
    .trim();

  return value;
}

function cleanProductName(raw) {
  return cleanText(raw)
    // Strip inventory/urgency UI text
    .replace(/^only\s+a\s+few\s+left\s+in\s+stock[!.]?\s*/i, "")
    .replace(/^low\s+stock[!.]?\s*/i, "")
    .replace(/^last\s+\d+\s+in\s+stock[!.]?\s*/i, "")
    // Strip THC/CBD percentages
    .replace(/\s*(?:THC|CBD|TAC):?\s*[\d.]+%.*$/i, "")
    .replace(/\s*\d+(?:\.\d+)?%\s*(?:THC|CBD|TAC).*$/i, "")
    // Strip leading price artifacts
    .replace(/^\$[\d.]+\s*\|?\s*/, "")
    .replace(/\$[\d.]+\s*\|\s*\d+\/?\d*\s*oz/i, "")
    // Strip trailing pipe characters
    .replace(/\s*\|\s*$/, "")
    .trim();
}

function filterListingEntries(entries) {
  return Array.from(
    new Map(
      entries
        .filter((entry) => entry && typeof entry.price === "number" && entry.product)
        .filter((entry) => !/^(deals?|featured)$/i.test(entry.product))
        .filter((entry) => !/^(?:1\s*oz|1\/2\s*oz|1\/4\s*oz|1\/8\s*oz|28\s*g|14\s*g|7\s*g|3\.5\s*g|add\s+to\s+cart)$/i.test(entry.product.trim()))
        .filter((entry) => !/^add\s+[\d./]+\s*(?:oz|g)\s+to\s+cart$/i.test(entry.product.trim()))
        .map((entry) => {
          const product = cleanProductName(entry.product);
          return [
            `${entry.size}|${entry.price}|${product}`,
            {
              ...entry,
              product,
              line: cleanText(entry.line),
              preGround: entry.preGround === true ? true : isPreGround(product)
            }
          ];
        })
        .filter(([, entry]) => entry.product.length > 0)
    ).values()
  );
}

function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
}

function extractJsonLdProducts(nodes, catalogName = "") {
  const products = [];

  for (const node of toArray(nodes)) {
    if (!node || typeof node !== "object") {
      continue;
    }

    if (node["@type"] === "Product") {
      products.push({
        catalogName,
        name: node.name ?? "",
        description: node.description ?? "",
        price: typeof node.offers?.price === "number" ? node.offers.price : Number(node.offers?.price),
        brand: node.brand?.name ?? "",
        availability: node.offers?.availability ?? ""
      });
      continue;
    }

    if (node["@type"] === "OfferCatalog") {
      const nextCatalogName = node.name ?? catalogName;
      products.push(...extractJsonLdProducts(node.itemListElement, nextCatalogName));
      continue;
    }

    if (node["@type"] === "LocalBusiness" || node["@type"] === "Store") {
      products.push(...extractJsonLdProducts(node.hasOfferCatalog, catalogName));
      continue;
    }

    products.push(...extractJsonLdProducts(node.itemListElement, catalogName));
    products.push(...extractJsonLdProducts(node.hasOfferCatalog, catalogName));
    products.push(...extractJsonLdProducts(node["@graph"], catalogName));
  }

  return products.filter((product) => Number.isFinite(product.price));
}

async function extractLeaflyMenuEntries(page, menuUrl) {
  await gotoWithRetries(page, menuUrl, { attempts: 3, timeout: 90000 });
  await page.waitForTimeout(4000);

  // Detect total product count from body text, e.g. "69 products | Last updated"
  const firstBodyText = await page.locator("body").innerText();
  const countMatch = firstBodyText.match(/(\d+)\s+products?\s*\|/i);
  const totalProducts = countMatch ? parseInt(countMatch[1], 10) : 0;
  const maxPages = totalProducts > 0 ? Math.min(Math.ceil(totalProducts / 18), 10) : 1;

  const entries = [];
  entries.push(...extractPriceEntries(firstBodyText));

  for (let p = 2; p <= maxPages; p++) {
    const sep = menuUrl.includes("?") ? "&" : "?";
    const pageUrl = `${menuUrl}${sep}page=${p}`;
    await gotoWithRetries(page, pageUrl, { attempts: 3, timeout: 90000 });
    await page.waitForTimeout(3500);
    const bodyText = await page.locator("body").innerText();
    entries.push(...extractPriceEntries(bodyText));
  }

  return { entries, totalProducts };
}

async function extractStructuredMenuEntries(page) {
  const scriptContents = await page.locator('script[type="application/ld+json"]').allTextContents();
  const products = [];

  for (const content of scriptContents) {
    try {
      const parsed = JSON.parse(content);
      products.push(...extractJsonLdProducts(parsed));
    } catch {
      continue;
    }
  }

  return products
    .filter((product) => /flower/i.test(product.catalogName))
    .map((product) => {
      const searchableText = `${product.name} ${product.description}`.trim();
      const size = detectSize(searchableText);
      if (!size) {
        return null;
      }

      const productName = normalizeWhitespace(product.name);
      return {
        size,
        price: product.price,
        line: searchableText,
        product: productName,
        preGround: isPreGround(productName) || isPreGround(searchableText)
      };
    })
    .filter(Boolean);
}

async function countStructuredProducts(page) {
  const scriptContents = await page.locator('script[type="application/ld+json"]').allTextContents();
  const products = [];

  for (const content of scriptContents) {
    try {
      const parsed = JSON.parse(content);
      products.push(...extractJsonLdProducts(parsed));
    } catch {
      continue;
    }
  }

  return {
    totalProducts: products.length,
    flowerProducts: products.filter((product) => /flower/i.test(product.catalogName)).length
  };
}

async function extractWeedmapsMenuEntries(page, menuUrl) {
  const pageUrls = new Set([menuUrl]);

  await gotoWithRetries(page, menuUrl, { attempts: 3, timeout: 90000 });
  await acceptWeedmapsAgeGate(page);
  await waitForWeedmapsListings(page);

  const paginationUrls = await page.locator('a[href*="?page="]').evaluateAll((nodes) =>
    nodes.map((node) => node.href).filter(Boolean)
  );
  for (const url of paginationUrls) {
    pageUrls.add(url);
  }

  const entries = [];
  for (const url of pageUrls) {
    await gotoWithRetries(page, url, { attempts: 3, timeout: 90000 });
    await acceptWeedmapsAgeGate(page);
    await waitForWeedmapsListings(page);

    const cardTexts = await page.locator('li[class*="ListingItemContainer"]').evaluateAll((nodes) =>
      nodes.map((node) => node.textContent || "")
    );

    for (const cardText of cardTexts) {
      const parsed = parseWeedmapsCardText(cardText);
      if (parsed) {
        entries.push(parsed);
      }
    }
  }

  const filtered = filterListingEntries(entries);
  if (filtered.length > 0) {
    return filtered;
  }

  await gotoWithRetries(page, menuUrl, { attempts: 3, timeout: 90000 });
  await acceptWeedmapsAgeGate(page);
  await page.waitForTimeout(3500);
  const fallbackText = await page.locator("body").innerText();
  return filterListingEntries(extractPriceEntries(fallbackText));
}

async function extractWeedmapsDeals(page, dealsUrl, dispensaryName = "") {
  await gotoWithRetries(page, dealsUrl, { attempts: 3, timeout: 90000 });
  await acceptWeedmapsAgeGate(page);
  await page.waitForTimeout(2000);

  const dispensarySlug = (() => {
    try {
      const pathname = new URL(dealsUrl).pathname;
      const parts = pathname.split("/").filter(Boolean);
      return parts[1] ?? "";
    } catch {
      return "";
    }
  })();

  const deals = await page.locator('a[href*="/deals/"]').evaluateAll(
    (nodes, context) =>
      nodes
        .map((node) => ({
          href: node.href,
          text: (node.textContent || "").replace(/\s+/g, " ").trim()
        }))
        .filter((item) => item.href.includes(`/dispensaries/${context.slug}/deals/`))
        .map((item) => item.text),
    { slug: dispensarySlug }
  );

  return Array.from(
    new Set(
      deals
        .map((deal) => normalizeDealLabel(deal, dispensaryName))
        .filter(Boolean)
    )
  );
}

async function extractNewAmsterdamEntries(page, menuUrl) {
  // Try Mosaic API interception first (works for shop.newamsterdam.nyc and
  // may work for newamsterdam.nyc/products/ if it also calls api.mosaic.green).
  // Fall back to Range/WordPress DOM parsing if no Mosaic data is captured.
  const mosaicEntries = await extractNewAmsterdamMosaic(page, menuUrl);
  if (mosaicEntries.length > 0) return mosaicEntries;
  return extractNewAmsterdamRange(page, menuUrl);
}

async function extractNewAmsterdamMosaic(page, menuUrl) {
  const allProducts = [];

  const responseHandler = async (response) => {
    const url = response.url();
    if (!url.includes("api.mosaic.green") || !url.includes("product-list")) {
      return;
    }
    try {
      const data = await response.json();
      // Mosaic wraps products under data.data.products or data.products
      const prods = data?.data?.products ?? data?.products ?? [];
      if (prods.length > 0) {
        allProducts.push(...prods);
      }
    } catch {
      // Non-JSON response, skip.
    }
  };

  page.on("response", responseHandler);
  // Always load the shop root so the age gate / category nav is available
  const shopRoot = menuUrl.replace(/\/products\/.*$/, "/").replace(/\/shop\/.*$/, "/");
  await gotoWithRetries(page, shopRoot, { attempts: 3, timeout: 90000 });
  await page.waitForTimeout(3000);

  // Accept age gate if present
  for (const text of [/^Yes$/i, /I am 21/i, /Enter/i, /Continue/i]) {
    try {
      const btn = page.getByText(text).first();
      if (await btn.isVisible({ timeout: 800 })) {
        await btn.click();
        await page.waitForTimeout(1500);
        break;
      }
    } catch { /* no age gate */ }
  }

  // Click the Flower category to trigger the flower product-list API call
  try {
    const flowerBtn = page.getByText(/^flower$/i).first();
    if (await flowerBtn.isVisible({ timeout: 3000 })) {
      await flowerBtn.click();
      await page.waitForTimeout(3000);
    }
  } catch { /* flower button not found, fall through */ }

  // Scroll to load all paginated products
  let previousCount = 0;
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
    if (i >= 3 && allProducts.length === previousCount) break;
    previousCount = allProducts.length;
  }

  page.off("response", responseHandler);

  const entries = [];
  for (const product of allProducts) {
    const size = detectSize(product.name ?? "");
    if (!size) continue;
    const variant = product.product_variants?.[0];
    const rawPrice = variant?.price ?? variant?.base_price;
    const price = Number(rawPrice);
    if (!price || isNaN(price)) continue;
    const productName = normalizeWhitespace(product.name);
    entries.push({ size, price, line: product.name, product: productName, preGround: isPreGround(productName) });
  }
  return filterListingEntries(entries);
}

async function extractNewAmsterdamRange(page, menuUrl) {
  // Range/WordPress platform at newamsterdam.nyc — uses JS-rendered product cards
  // Captures sale price when available, falls back to regular price
  await gotoWithRetries(page, menuUrl, { attempts: 3, timeout: 90000 });
  await page.waitForTimeout(4000);

  // Scroll to load all products
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
  }

  const entries = await page.evaluate(() => {
    const results = [];
    // Range platform product cards — try multiple selector patterns
    const cards = document.querySelectorAll(
      '.product-card, .product, article.product, [class*="product-item"], [class*="ProductCard"], .woocommerce-loop-product'
    );

    for (const card of cards) {
      const nameEl = card.querySelector('.product-title, .product-name, h2, h3, [class*="title"], [class*="name"]');
      const name = nameEl?.textContent?.trim() ?? "";
      if (!name) continue;

      // Prefer sale/discounted price over regular price
      const salePriceEl = card.querySelector('ins .amount, .sale-price, [class*="sale"], ins');
      const regularPriceEl = card.querySelector('del .amount, .regular-price, [class*="regular"], .price');
      const anyPriceEl = card.querySelector('.amount, .price, [class*="price"]');

      const priceText = (salePriceEl ?? anyPriceEl)?.textContent?.trim() ?? "";
      const priceMatch = priceText.match(/[\d]+(?:\.\d{1,2})?/);
      if (!priceMatch) continue;

      const price = parseFloat(priceMatch[0]);
      if (!price || isNaN(price)) continue;

      results.push({ name, price });
    }
    return results;
  });

  // Fallback: extract from page text if card parsing yielded nothing
  if (entries.length === 0) {
    const bodyText = await page.evaluate(() => document.body.innerText);
    return filterListingEntries(extractPriceEntries(bodyText));
  }

  const parsed = [];
  for (const { name, price } of entries) {
    const size = detectSize(name);
    if (!size) continue;
    const productName = cleanProductName(normalizeWhitespace(name));
    parsed.push({ size, price, line: name, product: productName, preGround: isPreGround(productName) });
  }
  return filterListingEntries(parsed);
}

async function extractNewAmsterdamDeals(page, dealsUrl) {
  // Try the dedicated specials page first
  const specialsUrl = dealsUrl.includes("specials")
    ? dealsUrl
    : dealsUrl.replace(/\/products(\?|$)/, "/specials$1");

  let dealsFound = [];

  try {
    await gotoWithRetries(page, specialsUrl, { attempts: 3, timeout: 60000 });
    await page.waitForTimeout(3000);

    // Intercept Mosaic API responses for specials/promotions data
    const apiDeals = [];
    const onResponse = async (response) => {
      const url = response.url();
      if (!url.includes("api.mosaic.green")) return;
      if (!/special|promo|deal|discount/i.test(url)) return;
      try {
        const data = await response.json();
        const items = data?.specials ?? data?.promotions ?? data?.deals ?? data?.items ?? [];
        for (const item of items) {
          const label = item?.title ?? item?.name ?? item?.description ?? "";
          if (label) apiDeals.push(cleanText(label));
        }
      } catch {
        // Non-JSON, skip.
      }
    };
    page.on("response", onResponse);
    await page.waitForTimeout(2000);
    page.off("response", onResponse);

    if (apiDeals.length > 0) {
      dealsFound = apiDeals;
    } else {
      // Fall back to body text parsing
      const bodyText = await page.locator("body").innerText();
      const lines = bodyText
        .split("\n")
        .map((line) => cleanText(line))
        .filter(Boolean);

      // Look for a "specials" or "deals" heading and collect lines after it
      const startIdx = lines.findIndex((line) => /^(specials?|deals?|promotions?)$/i.test(line));
      if (startIdx !== -1) {
        for (let i = startIdx + 1; i < lines.length; i += 1) {
          const line = lines[i];
          if (/^(menu|products?|shop|home|about|contact|cart|login)$/i.test(line)) break;
          if (/^\$\d/.test(line) || /^\d+%/.test(line)) continue;
          if (line.length < 4) continue;
          dealsFound.push(line);
          if (dealsFound.length >= 10) break;
        }
      }
    }
  } catch {
    // Specials page failed, attempt main page fallback
  }

  // Fallback: check main products page for deal banners
  if (dealsFound.length === 0) {
    try {
      await gotoWithRetries(page, dealsUrl, { attempts: 3, timeout: 60000 });
      await page.waitForTimeout(2500);

      // Look for banner/promo elements by common selectors
      const bannerSelectors = [
        '[class*="banner"]',
        '[class*="promo"]',
        '[class*="deal"]',
        '[class*="special"]',
        '[class*="announcement"]',
        '[class*="notice"]'
      ];
      for (const sel of bannerSelectors) {
        try {
          const texts = await page.locator(sel).evaluateAll(
            (nodes) => nodes.map((n) => (n.innerText || n.textContent || "").replace(/\s+/g, " ").trim())
          );
          for (const t of texts) {
            const cleaned = cleanText(t);
            if (cleaned && cleaned.length > 4) dealsFound.push(cleaned);
          }
          if (dealsFound.length > 0) break;
        } catch {
          // Selector not found, continue.
        }
      }
    } catch {
      // Fallback also failed, return empty.
    }
  }

  return Array.from(new Set(dealsFound.map((d) => cleanText(d)).filter(Boolean)));
}

async function extractJointEntries(page, menuUrl) {
  // Joint eCommerce (used by Dazed, getsmacked.online, verdicannabis.com, etc.)
  // Products are rendered client-side via a SPA router. We intercept the wp-admin
  // AJAX responses that carry product JSON, and fall back to body text parsing.
  const allProducts = [];

  const responseHandler = async (response) => {
    const url = response.url();
    // The Joint platform loads products via wp-admin/admin-ajax.php or
    // joint-ecommerce REST endpoints; both return JSON arrays/objects of products.
    if (!url.includes("admin-ajax.php") && !url.includes("joint-ecommerce/v1")) {
      return;
    }
    try {
      const data = await response.json();
      // The AJAX response may be wrapped in various shapes – look for products array
      const candidates = [
        data?.products,
        data?.data?.products,
        data?.items,
        data?.data?.items,
        Array.isArray(data) ? data : null
      ];
      for (const list of candidates) {
        if (Array.isArray(list) && list.length > 0) {
          allProducts.push(...list);
          break;
        }
      }
    } catch {
      // Non-JSON response – ignore.
    }
  };

  // The Dazed menu uses a multi-location SPA route: /menu/{location}/categories/flower/
  // Navigating directly to the deep SPA path sometimes fails to trigger the product
  // fetch. Load the location base URL instead and let the SPA router settle first.
  const baseMenuUrl = menuUrl.replace(/\/categories\/.*$/, "/");

  page.on("response", responseHandler);
  await gotoWithRetries(page, baseMenuUrl, { attempts: 3, timeout: 90000, waitUntil: "domcontentloaded" });
  // Wait for JS framework to initialise
  await page.waitForTimeout(3000);

  // If base URL differs from the full URL, now navigate to the flower category
  if (baseMenuUrl !== menuUrl) {
    try {
      await page.goto(menuUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch {
      // Navigation error on SPA route — stay on base page, products may already be loaded
    }
    await page.waitForTimeout(3000);
  }

  // Scroll to trigger lazy-loading
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);
  }

  page.off("response", responseHandler);

  // If we captured products via API interception, parse them
  if (allProducts.length > 0) {
    const entries = [];
    for (const product of allProducts) {
      // Joint products typically have `name` (may include "3.5g" / "28g") and price fields.
      const name = product.name ?? product.title ?? product.product_name ?? "";
      if (!name) continue;

      // Prefer sale/discount price; price fields vary by Joint API version
      const rawPrice =
        product.sale_price ??
        product.price_sale ??
        product.discounted_price ??
        product.price ??
        product.base_price ??
        product.variants?.[0]?.price ??
        product.product_variants?.[0]?.price ??
        product.product_variants?.[0]?.base_price;
      const price = rawPrice != null ? Number(rawPrice) : NaN;
      if (isNaN(price) || price <= 0) continue;

      // Size may be in product name or a dedicated weight field
      const weightText = product.weight ?? product.size ?? product.unit ?? "";
      const searchText = `${name} ${weightText}`.trim();
      const size = detectSize(searchText);
      if (!size) continue;

      const productName = cleanProductName(normalizeWhitespace(name));
      entries.push({ size, price, line: searchText, product: productName, preGround: isPreGround(productName) || isPreGround(searchText) });
    }
    if (entries.length > 0) {
      return filterListingEntries(entries);
    }
  }

  // Fallback: parse body text (same approach as Smacked Village generic path,
  // but with longer wait and scroll already done above)
  const bodyText = await page.locator("body").innerText();
  return filterListingEntries(extractPriceEntries(bodyText));
}

async function extractBlazeEntries(page, menuUrl) {
  await gotoWithRetries(page, menuUrl, { attempts: 3, timeout: 90000 });
  await acceptBlazeAgeGate(page);
  await page.waitForTimeout(2500);
  const bodyText = await page.locator("body").innerText();
  return filterListingEntries(extractPriceEntries(bodyText));
}

async function extractBlazeDeals(page, dealsUrl) {
  await gotoWithRetries(page, dealsUrl, { attempts: 3, timeout: 90000 });
  await acceptBlazeAgeGate(page);
  await page.waitForTimeout(2000);

  const text = await page.locator("body").innerText();
  const lines = text.split("\n").map((line) => cleanText(line)).filter(Boolean);
  const start = lines.findIndex((line) => /^(current deals|deals)$/i.test(line));
  if (start === -1) {
    return [];
  }

  const deals = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^(recommended products|new on the menu|all brands page|filter|shop all|view all)$/i.test(line)) {
      if (deals.length > 0) {
        break;
      }
      continue;
    }
    if (/^(pickup|delivery|login|checkout|your cart)$/i.test(line)) {
      continue;
    }
    if (/\$\d/.test(line) || /^(bundle|collection)$/i.test(line)) {
      continue;
    }
    deals.push(line);
    if (deals.length >= 6) {
      break;
    }
  }

  return Array.from(new Set(deals));
}

async function extractJointDeals(page, dealsUrl) {
  // Joint/Surfside eCommerce specials page — intercept the API response first,
  // then fall back to body text parsing if the API is not triggered.
  const allDeals = [];

  const responseHandler = async (response) => {
    const url = response.url();
    if (!url.includes("admin-ajax.php") && !url.includes("joint-ecommerce/v1")) return;
    if (!/special|promo|deal|discount/i.test(url)) return;
    try {
      const data = await response.json();
      const candidates = [data?.specials, data?.promotions, data?.deals, data?.data?.specials, Array.isArray(data) ? data : null];
      for (const list of candidates) {
        if (Array.isArray(list) && list.length > 0) {
          for (const item of list) {
            const label = item?.title ?? item?.name ?? item?.description ?? "";
            if (label) allDeals.push(cleanText(label));
          }
          break;
        }
      }
    } catch { /* Non-JSON */ }
  };

  page.on("response", responseHandler);
  try {
    await gotoWithRetries(page, dealsUrl, { attempts: 2, timeout: 60000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(3000);
  } catch { /* ignore navigation errors */ }
  page.off("response", responseHandler);

  if (allDeals.length > 0) return Array.from(new Set(allDeals));

  // Body text fallback
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const lines = bodyText.split("\n").map(l => cleanText(l)).filter(Boolean);
  const startIdx = lines.findIndex(l => /^(specials?|deals?|promotions?|current deals?)$/i.test(l));
  if (startIdx === -1) return [];
  const deals = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^(menu|home|shop|products?|cart|login|checkout|about|contact|search|delivery|pickup|open|closed|dispensary info|available for pre-order)$/i.test(line)) break;
    if (/^\$\d/.test(line) || /^\d+%/.test(line) || line.length < 10) continue;
    deals.push(line);
    if (deals.length >= 8) break;
  }
  return Array.from(new Set(deals));
}

async function extractConbudDeals(page, dealsUrl) {
  try {
    await gotoWithRetries(page, dealsUrl, { attempts: 2, timeout: 60000, waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
  } catch { return []; }
  const bodyText = await page.locator("body").innerText().catch(() => "");
  const lines = bodyText.split("\n").map(l => cleanText(l)).filter(Boolean);
  const startIdx = lines.findIndex(l => /^(specials?|deals?|promotions?)$/i.test(l));
  if (startIdx === -1) return [];
  const deals = [];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^(menu|home|shop|products?|flower|cart|login|search|delivery|pickup|open|closed|dispensary info|available for pre-order)$/i.test(line)) break;
    if (/^\$\d/.test(line) || line.length < 10) continue;
    deals.push(line);
    if (deals.length >= 8) break;
  }
  return Array.from(new Set(deals));
}

async function extractKushKlubEntries(page, menuUrl) {
  await gotoWithRetries(page, menuUrl, { attempts: 3, timeout: 90000 });

  // Handle any age-gate variants (Blaze-style or a generic yes/confirm button)
  for (const text of [/Yes! Shop store pick-up/i, /^Yes$/i, /I am 21/i, /Enter/i, /Confirm/i]) {
    try {
      const btn = page.getByText(text).first();
      if (await btn.isVisible({ timeout: 800 })) {
        await btn.click();
        await page.waitForTimeout(1200);
        break;
      }
    } catch {
      // No matching button.
    }
  }

  // Wait for iHeartJane to initialise its shadow-DOM product grid
  await page.waitForTimeout(5000);

  // Click the "Flower" category tab inside the shadow DOM to load the full flower list
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("*")) {
      if (el.shadowRoot) {
        for (const link of el.shadowRoot.querySelectorAll("a, button")) {
          if (/^flower$/i.test((link.textContent || "").trim())) {
            link.click();
            return;
          }
        }
      }
    }
  });

  // Wait for the flower products to render, then scroll to trigger lazy-loading
  await page.waitForTimeout(4000);
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
  }

  const entries = [];

  // KushKlub uses iHeartJane (store 6906) which mounts its product grid inside a
  // shadow DOM – document.body.innerText() misses it entirely.
  // Pierce the shadow root to get rendered product text.
  const shadowText = await page.evaluate(() => {
    for (const el of document.querySelectorAll("*")) {
      if (el.shadowRoot) {
        const texts = [];
        for (const child of el.shadowRoot.children) {
          if (child.tagName !== "STYLE") {
            try { texts.push(child.innerText || child.textContent || ""); } catch { /* skip */ }
          }
        }
        const joined = texts.join("\n");
        if (joined.length > 200) return joined;
      }
    }
    return "";
  });

  if (shadowText) {
    entries.push(...extractPriceEntries(shadowText));
  }

  // Fallback: full body text (catches any products rendered outside shadow DOM)
  const bodyText = await page.locator("body").innerText();
  entries.push(...extractPriceEntries(bodyText));

  return filterListingEntries(entries);
}

// Map a Dutchie-embed host URL to a canonical dutchie.com embedded-menu URL.
// Handles three forms:
//   1. https://dutchie.com/dispensary/SLUG/categories/flower  → embed URL
//   2. https://dutchie.com/embedded-menu/SLUG/...              → already correct
//   3. https://example.com/shop?dtche%5Bcategory%5D=flower     → must resolve iframe src
function resolveDutchieEmbedUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);

    // Already a dutchie.com URL
    if (parsed.hostname === "dutchie.com") {
      // Convert /dispensary/SLUG/... → /embedded-menu/SLUG/categories/flower
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts[0] === "dispensary" && parts[1]) {
        return `https://dutchie.com/embedded-menu/${parts[1]}/categories/flower`;
      }
      // Already embedded-menu or similar — return as-is
      return rawUrl;
    }
  } catch {
    // Not a valid URL, fall through
  }
  return null; // Requires iframe sniffing at runtime
}

async function extractGreenGeniusEntries(page, menuUrl) {
  const allProducts = [];

  // Passively capture Dutchie Plus GraphQL responses (filteredProducts)
  const onResponse = async (response) => {
    const url = response.url();
    if (!url.includes("graphql")) return;
    try {
      const json = await response.json();
      const products =
        json?.data?.filteredProducts?.products ??
        json?.data?.filteredProducts?.items ??
        [];
      if (Array.isArray(products) && products.length > 0) {
        process.stderr.write(`[GreenGenius] graphql batch: ${products.length} type=${products[0]?.type}\n`);
        allProducts.push(...products);
      }
    } catch (e) {
      process.stderr.write(`[GreenGenius] graphql parse error: ${e.message}\n`);
    }
  };
  page.on("response", onResponse);

  process.stderr.write(`[GreenGenius] navigating to ${menuUrl}\n`);
  await gotoWithRetries(page, menuUrl, { attempts: 3, timeout: 90000 });
  process.stderr.write(`[GreenGenius] navigation done, allProducts=${allProducts.length}\n`);
  await page.waitForTimeout(3000);
  process.stderr.write(`[GreenGenius] after 3s wait, allProducts=${allProducts.length}\n`);

  // Accept age gate if present
  for (const text of [/I am 21/i, /I'm 21/i, /Enter/i, /Yes/i, /Continue/i]) {
    try {
      const btn = page.getByText(text).first();
      if (await btn.isVisible({ timeout: 800 })) {
        await btn.click();
        await page.waitForTimeout(1500);
        break;
      }
    } catch { /* no gate */ }
  }

  // Scroll to load all paginated products
  let prevCount = 0;
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
    if (i >= 5 && allProducts.length === prevCount) break;
    prevCount = allProducts.length;
  }

  page.off("response", onResponse);
  process.stderr.write(`[GreenGenius] done scrolling, allProducts=${allProducts.length}\n`);

  const entries = [];
  const flowerProducts = allProducts.filter((p) => {
    const t = (p.type ?? p.category ?? "").toLowerCase();
    return t === "flower" || t === "pre-roll" || t === "" || t == null;
  });

  for (const product of flowerProducts) {
    const name = product.Name ?? product.name ?? "";
    const options = product.Options ?? product.options ?? [];
    const prices = product.recPrices ?? product.rec_prices ?? product.prices ?? [];

    if (options.length === 0) {
      // Product with no variants — detect size from name
      const price = Array.isArray(prices) ? prices[0] : prices;
      const size = detectSize(name);
      if (size && price != null) {
        entries.push({ name: normalizeWhitespace(name), size, price: Number(price), preGround: isPreGround(name) });
      }
    } else {
      options.forEach((opt, idx) => {
        const optStr = String(opt ?? "");
        const size = detectSize(optStr) ?? detectSize(name);
        const price = Array.isArray(prices) ? prices[idx] : prices;
        if (size && price != null) {
          const label = `${normalizeWhitespace(name)} (${optStr})`;
          entries.push({ name: label, size, price: Number(price), preGround: isPreGround(name) });
        }
      });
    }
  }

  // Fallback: if GraphQL gave nothing, parse body text
  if (entries.length === 0) {
    const bodyText = await page.locator("body").innerText();
    return filterListingEntries(extractPriceEntries(bodyText));
  }

  return filterListingEntries(entries);
}

async function extractDutchieEntries(page, menuUrl) {
  const preresolved = resolveDutchieEmbedUrl(menuUrl);

  let embedUrl = preresolved;

  if (!embedUrl) {
    // Load the host page and sniff the Dutchie iframe src
    await gotoWithRetries(page, menuUrl, { attempts: 3, timeout: 90000 });
    await page.waitForTimeout(3000);

    const iframeSrc = await page.locator('iframe[src*="dutchie.com"]').first().getAttribute("src").catch(() => null);
    if (iframeSrc) {
      embedUrl = iframeSrc.startsWith("http") ? iframeSrc : `https:${iframeSrc}`;
      // Normalise to categories/flower if not already
      if (!embedUrl.includes("categories/flower") && !embedUrl.includes("category=flower")) {
        const embedParsed = new URL(embedUrl);
        const slugParts = embedParsed.pathname.split("/").filter(Boolean);
        // /embedded-menu/SLUG → /embedded-menu/SLUG/categories/flower
        if (slugParts[0] === "embedded-menu" && slugParts[1] && slugParts.length < 3) {
          embedUrl = `https://dutchie.com/embedded-menu/${slugParts[1]}/categories/flower`;
        }
      }
    }
  }

  if (!embedUrl) {
    // Dutchie Plus: no iframe, full SPA — page already loaded above.
    // Scroll and wait for products to render, then parse body text.
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1200);
    }
    const bodyText = await page.locator("body").innerText();
    return filterListingEntries(extractPriceEntries(bodyText));
  }

  // Scrape the resolved embed URL directly
  await gotoWithRetries(page, embedUrl, { attempts: 3, timeout: 90000 });

  // Accept any age gate
  for (const text of [/I am 21/i, /I'm 21/i, /Enter/i, /Yes/i, /Continue/i]) {
    try {
      const btn = page.getByText(text).first();
      if (await btn.isVisible({ timeout: 800 })) {
        await btn.click();
        await page.waitForTimeout(1000);
        break;
      }
    } catch {
      // No matching button.
    }
  }

  // Wait for product cards to render and scroll to load all
  await page.waitForTimeout(4000);
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
  }

  const entries = [];

  // Try structured product card selectors first
  const cardSelectors = [
    '[data-testid*="product"]',
    '[class*="product-card"]',
    '[class*="ProductCard"]',
    '[class*="menu-item"]',
    '[class*="MenuItem"]',
    'li[class*="product"]',
    'article'
  ];
  for (const sel of cardSelectors) {
    try {
      const cardTexts = await page.locator(sel).evaluateAll(
        (nodes) => nodes.map((n) => (n.innerText || n.textContent || "").replace(/\s+/g, " ").trim())
      );
      if (cardTexts.length === 0) continue;
      for (const text of cardTexts) {
        entries.push(...extractPriceEntries(text));
      }
      if (entries.length > 0) break;
    } catch {
      // selector not found
    }
  }

  // Always also grab full body text
  const bodyText = await page.locator("body").innerText();
  entries.push(...extractPriceEntries(bodyText));

  return filterListingEntries(entries);
}

async function acceptGothamAgeGate(page) {
  const yesButton = page.getByText(/Yes, let's go/i).first();
  try {
    if (await yesButton.isVisible({ timeout: 1500 })) {
      await yesButton.click();
      await page.waitForTimeout(1000);
    }
  } catch {
    // No age gate present.
  }
}

async function extractGothamEntries(page, menuUrl) {
  await gotoWithRetries(page, menuUrl, { attempts: 3, timeout: 90000 });
  await page.waitForTimeout(6000);
  await acceptGothamAgeGate(page);
  const bodyText = await page.locator("body").innerText();
  return filterListingEntries(extractPriceEntries(bodyText));
}

async function extractConbudEntries(page, menuUrl) {
  const base = menuUrl.split("?")[0];
  const filterUrls = [
    base + "?weight=1oz",
    base + "?weight=1-2oz"
  ];
  const entries = [];

  for (const url of [menuUrl, ...filterUrls]) {
    await gotoWithRetries(page, url, { attempts: 3, timeout: 90000 });
    await page.waitForTimeout(2500);

    // Collect text from product link elements specifically
    const productLinkTexts = await page.locator('a[href*="/product"]').evaluateAll(
      (nodes) => nodes.map((node) => (node.textContent || "").replace(/\s+/g, " ").trim())
    );
    for (const text of productLinkTexts) {
      entries.push(...extractPriceEntries(text));
    }

    // Also parse full body text as fallback
    const bodyText = await page.locator("body").innerText();
    entries.push(...extractPriceEntries(bodyText));
  }

  return filterListingEntries(entries);
}

async function extractWooCommerceEntries(page, menuUrl) {
  // Derive the WooCommerce Store API base from the shop page URL.
  // Blue Forest Farms uses /wp-json/wc/store/v1/products with category_id=61 (Flower).
  const parsedUrl = new URL(menuUrl);
  const apiBase = `${parsedUrl.protocol}//${parsedUrl.hostname}/wp-json/wc/store/v1/products`;

  const allProducts = [];
  const perPage = 100;

  // Fetch up to 5 pages (500 products) to handle large catalogs.
  for (let page_num = 1; page_num <= 5; page_num += 1) {
    const apiUrl = `${apiBase}?category=61&per_page=${perPage}&page=${page_num}`;
    try {
      const response = await fetch(apiUrl, {
        headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" }
      });
      if (!response.ok) {
        break;
      }
      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) {
        break;
      }
      allProducts.push(...data);
      if (data.length < perPage) {
        break;
      }
    } catch {
      break;
    }
  }

  const entries = [];
  for (const product of allProducts) {
    const rawName = product.name ?? "";
    if (!rawName) continue;
    // Decode HTML entities that WooCommerce sometimes includes in product names
    const name = decodeEntities(rawName);

    // Prices are stored as cent-strings (e.g. "4500" = $45.00).
    // Prefer sale_price when it differs from regular_price, otherwise use price.
    const rawSale = product.prices?.sale_price;
    const rawRegular = product.prices?.regular_price;
    const rawPrice = product.prices?.price;

    const saleVal = rawSale != null ? Number(rawSale) / 100 : null;
    const regularVal = rawRegular != null ? Number(rawRegular) / 100 : null;
    const priceVal = rawPrice != null ? Number(rawPrice) / 100 : null;

    // Use sale price if it's lower than regular; otherwise use price.
    let price = priceVal;
    if (saleVal !== null && regularVal !== null && saleVal < regularVal) {
      price = saleVal;
    }
    if (price === null || isNaN(price) || price <= 0) continue;

    const size = detectSize(name);
    if (!size) continue;

    const productName = cleanProductName(normalizeWhitespace(name));
    entries.push({
      size,
      price,
      line: name,
      product: productName,
      preGround: isPreGround(productName) || isPreGround(name)
    });
  }

  return filterListingEntries(entries);
}

function summarizeEntries(entries, size) {
  const matches = entries.filter((entry) => entry.size === size);
  if (matches.length === 0) {
    return { lowest: null, count: 0 };
  }
  const lowest = matches.reduce((best, current) => (current.price < best.price ? current : best));
  return { lowest, count: matches.length };
}

async function scrapeStore(page, dispensary) {
  const resolvedMenuUrl = dispensary.menuUrlOverride ?? (dispensary.leaflySlug ? flowerMenuUrl(dispensary.leaflySlug) : null);
  const resolvedDealsUrl = dispensary.dealsUrlOverride ?? (dispensary.leaflySlug ? dealsUrl(dispensary.leaflySlug) : null);
  const menuProvider = urlProvider(resolvedMenuUrl);
  const dealsProvider = urlProvider(resolvedDealsUrl);

  const result = {
    ...dispensary,
    menuUrl: resolvedMenuUrl,
    dealsUrl: resolvedDealsUrl,
    status: "skipped",
    ounceListings: [],
    halfOunceListings: [],
    quarterOunceListings: [],
    eighthOunceListings: [],
    deals: [],
    error: null,
    totalProducts: 0,
    flowerProducts: 0,
    provider: menuProvider
  };

  if (!resolvedMenuUrl) {
    result.error = "No confirmed menu URL configured.";
    return result;
  }

  try {
    let allEntries = [];
    if (menuProvider === "leafly") {
      const { entries: leaflyEntries, totalProducts: leaflyTotal } =
        await extractLeaflyMenuEntries(page, result.menuUrl);
      allEntries = leaflyEntries;
      result.totalProducts = leaflyTotal;
      result.flowerProducts = leaflyEntries.length;
    } else if (menuProvider === "weedmaps") {
      allEntries = await extractWeedmapsMenuEntries(page, result.menuUrl);
      result.totalProducts = allEntries.length;
      result.flowerProducts = allEntries.length;
    } else if (menuProvider === "newamsterdam") {
      allEntries = await extractNewAmsterdamEntries(page, result.menuUrl);
      result.totalProducts = allEntries.length;
      result.flowerProducts = allEntries.length;
    } else if (menuProvider === "joint") {
      allEntries = await extractJointEntries(page, result.menuUrl);
      result.totalProducts = allEntries.length;
      result.flowerProducts = allEntries.length;
    } else if (menuProvider === "blaze") {
      allEntries = await extractBlazeEntries(page, result.menuUrl);
      result.totalProducts = allEntries.length;
      result.flowerProducts = allEntries.length;
    } else if (menuProvider === "kushklub") {
      allEntries = await extractKushKlubEntries(page, result.menuUrl);
      result.totalProducts = allEntries.length;
      result.flowerProducts = allEntries.length;
    } else if (menuProvider === "gotham") {
      allEntries = await extractGothamEntries(page, result.menuUrl);
      result.totalProducts = allEntries.length;
      result.flowerProducts = allEntries.length;
    } else if (menuProvider === "conbud") {
      allEntries = await extractConbudEntries(page, result.menuUrl);
      result.totalProducts = allEntries.length;
      result.flowerProducts = allEntries.length;
    } else if (menuProvider === "greengenius") {
      allEntries = await extractGreenGeniusEntries(page, result.menuUrl);
      result.totalProducts = allEntries.length;
      result.flowerProducts = allEntries.length;
    } else if (menuProvider === "dutchie") {
      allEntries = await extractDutchieEntries(page, result.menuUrl);
      result.totalProducts = allEntries.length;
      result.flowerProducts = allEntries.length;
    } else if (menuProvider === "woocommerce") {
      allEntries = await extractWooCommerceEntries(page, result.menuUrl);
      result.totalProducts = allEntries.length;
      result.flowerProducts = allEntries.length;
    } else {
      await gotoWithRetries(page, result.menuUrl, { attempts: 3, timeout: 90000 });
      await page.waitForTimeout(2500);
      const menuText = await page.locator("body").innerText();
      allEntries = extractPriceEntries(menuText);
      result.totalProducts = await page.locator('a[href*="/menu/"], a[href*="/product"], a[href*="/p/"]').count();
      result.flowerProducts = allEntries.length;
    }

    const dedupedEntries = filterListingEntries(allEntries);

    result.ounceListings = dedupedEntries.filter((entry) => entry.size === "1 oz");
    result.halfOunceListings = dedupedEntries.filter((entry) => entry.size === "1/2 oz");
    result.quarterOunceListings = dedupedEntries.filter((entry) => entry.size === "1/4 oz");
    result.eighthOunceListings = dedupedEntries.filter((entry) => entry.size === "1/8 oz");
    result.status = (
      result.ounceListings.length > 0 ||
      result.halfOunceListings.length > 0 ||
      result.quarterOunceListings.length > 0 ||
      result.eighthOunceListings.length > 0
    ) ? "ok" : "no_target_sizes";
    if (result.status === "no_target_sizes") {
      result.error = `Menu loaded, but no 1 oz, 1/2 oz, 1/4 oz, or 1/8 oz flower listings were found. Flower products seen: ${result.flowerProducts}.`;
    }
  } catch (error) {
    result.status = "menu_error";
    result.error = error instanceof Error ? error.message : String(error);
  }

  if (result.dealsUrl) {
    try {
      if (dealsProvider === "weedmaps") {
        result.deals = await extractWeedmapsDeals(page, result.dealsUrl, result.name);
      } else if (dealsProvider === "blaze") {
        result.deals = await extractBlazeDeals(page, result.dealsUrl);
      } else if (dealsProvider === "newamsterdam") {
        result.deals = await extractNewAmsterdamDeals(page, result.dealsUrl);
      } else if (dealsProvider === "joint") {
        result.deals = await extractJointDeals(page, result.dealsUrl);
      } else if (dealsProvider === "conbud") {
        result.deals = await extractConbudDeals(page, result.dealsUrl);
      } else {
        await gotoWithRetries(page, result.dealsUrl, { attempts: 3, timeout: 90000 });
        await page.waitForTimeout(2000);
        const dealsText = await page.locator("body").innerText();
        result.deals = extractDeals(dealsText).map((deal) => cleanText(deal)).filter(Boolean);
      }
    } catch (error) {
      if (result.error) {
        result.error += ` | Deals: ${error instanceof Error ? error.message : String(error)}`;
      } else {
      result.error = `Deals: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
  }

  result.deals = Array.from(new Set(result.deals.map((deal) => cleanText(deal)).filter(Boolean)));

  return result;
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    ignoreHTTPSErrors: true,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  });

  const DEFAULT_STORE_TIMEOUT_MS = 30000;
  const SLOW_STORE_TIMEOUT_MS = 60000;
  const SLOW_STORES = new Set(["New Amsterdam", "Mighty Lucky", "Green Genius", "Blue Forest Farms", "KushKlub NYC"]);

  const results = [];
  for (const dispensary of dispensaries) {
    const storeTimeoutMs = SLOW_STORES.has(dispensary.name) ? SLOW_STORE_TIMEOUT_MS : DEFAULT_STORE_TIMEOUT_MS;
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          ...dispensary,
          menuUrl: dispensary.menuUrlOverride ?? null,
          dealsUrl: dispensary.dealsUrlOverride ?? null,
          status: "timeout",
          ounceListings: [],
          halfOunceListings: [],
          quarterOunceListings: [],
          eighthOunceListings: [],
          deals: [],
          error: `Scrape timed out after ${storeTimeoutMs / 1000}s`,
          totalProducts: 0,
          flowerProducts: 0,
          provider: "unknown"
        });
      }, storeTimeoutMs);
    });
    const result = await Promise.race([scrapeStore(page, dispensary), timeoutPromise]);
    results.push(result);
    const skipReason = (result.status === "skipped" || result.status === "no_target_sizes" || result.status === "menu_error" || result.status === "timeout")
      ? ` | reason: ${result.error ?? result.sourceNote ?? "unknown"}`
      : "";
    console.log(`${result.name}: ${result.status} | oz=${result.ounceListings.length} | half=${result.halfOunceListings.length} | quarter=${result.quarterOunceListings.length} | eighth=${result.eighthOunceListings.length} | deals=${result.deals.length}${skipReason}`);
  }

  await browser.close();

  const summary = results.map((result) => {
    const ounceSummary = summarizeEntries(result.ounceListings, "1 oz");
    const halfSummary = summarizeEntries(result.halfOunceListings, "1/2 oz");
    const quarterSummary = summarizeEntries(result.quarterOunceListings, "1/4 oz");
    const eighthSummary = summarizeEntries(result.eighthOunceListings, "1/8 oz");

    // Non-pre-ground cheapest: prefer real flower, fall back to any if none found
    const ounceFlowerListings = result.ounceListings.filter((e) => !e.preGround);
    const halfFlowerListings = result.halfOunceListings.filter((e) => !e.preGround);
    const quarterFlowerListings = result.quarterOunceListings.filter((e) => !e.preGround);
    const eighthFlowerListings = result.eighthOunceListings.filter((e) => !e.preGround);
    const ounceFlowerSummary = summarizeEntries(ounceFlowerListings.length > 0 ? ounceFlowerListings : result.ounceListings, "1 oz");
    const halfFlowerSummary = summarizeEntries(halfFlowerListings.length > 0 ? halfFlowerListings : result.halfOunceListings, "1/2 oz");
    const quarterFlowerSummary = summarizeEntries(quarterFlowerListings.length > 0 ? quarterFlowerListings : result.quarterOunceListings, "1/4 oz");
    const eighthFlowerSummary = summarizeEntries(eighthFlowerListings.length > 0 ? eighthFlowerListings : result.eighthOunceListings, "1/8 oz");

    return {
      ...result,
      cheapestOunce: ounceSummary.lowest,
      cheapestHalfOunce: halfSummary.lowest,
      cheapestQuarterOunce: quarterSummary.lowest,
      cheapestEighthOunce: eighthSummary.lowest,
      cheapestOunceFlower: ounceFlowerSummary.lowest,
      cheapestHalfOunceFlower: halfFlowerSummary.lowest,
      cheapestQuarterOunceFlower: quarterFlowerSummary.lowest,
      cheapestEighthOunceFlower: eighthFlowerSummary.lowest
    };
  });

  // Archive a daily snapshot before overwriting — foundation for price history/trends
  await fs.mkdir(HISTORY_DIR, { recursive: true });
  const dateStamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const historyPath = path.join(HISTORY_DIR, `${dateStamp}.json`);
  await fs.writeFile(historyPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  await fs.writeFile(JSON_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const okCount = summary.filter((r) => r.status === "ok").length;
  const metadata = {
    scrapedAt: new Date().toISOString(),
    totalStores: summary.length,
    okStores: okCount
  };
  await fs.writeFile(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  const priceRows = [
    [
      "name",
      "address",
      "neighborhood",
      "status",
      "size",
      "price",
      "product",
      "pre_ground",
      "menu_url",
      "source_note"
    ],
    ...summary.flatMap((result) => {
      const rows = [];
      for (const entry of [
        ...result.ounceListings,
        ...result.halfOunceListings,
        ...result.quarterOunceListings,
        ...result.eighthOunceListings
      ]) {
        rows.push([
          result.name,
          result.address,
          result.neighborhood,
          result.status,
          entry.size,
          entry.price,
          entry.product,
          entry.preGround ? "true" : "false",
          result.menuUrl,
          result.sourceNote
        ]);
      }
      if (rows.length === 0) {
        rows.push([
          result.name,
          result.address,
          result.neighborhood,
          result.status,
          "",
          "",
          "",
          "",
          result.menuUrl ?? "",
          result.error ?? result.sourceNote
        ]);
      }
      return rows;
    })
  ];

  const dealRows = [
    ["name", "address", "neighborhood", "status", "deal", "deals_url"],
    ...summary.flatMap((result) => {
      if (result.deals.length === 0) {
        return [[result.name, result.address, result.neighborhood, result.status, "", result.dealsUrl ?? ""]];
      }
      return result.deals.map((deal) => [
        result.name,
        result.address,
        result.neighborhood,
        result.status,
        deal,
        result.dealsUrl ?? ""
      ]);
    })
  ];

  await fs.writeFile(
    PRICE_CSV_PATH,
    `${priceRows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`,
    "utf8"
  );
  await fs.writeFile(
    DEALS_CSV_PATH,
    `${dealRows.map((row) => row.map(csvEscape).join(",")).join("\n")}\n`,
    "utf8"
  );

  console.log(`Wrote ${JSON_PATH}`);
  console.log(`Wrote ${METADATA_PATH}`);
  console.log(`Wrote ${PRICE_CSV_PATH}`);
  console.log(`Wrote ${DEALS_CSV_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
