import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { dispensaries } from "./dispensaries.mjs";

const OUTPUT_DIR = path.resolve("output");
const JSON_PATH = path.join(OUTPUT_DIR, "dispensary-prices.json");
const METADATA_PATH = path.join(OUTPUT_DIR, "metadata.json");
const PRICE_CSV_PATH = path.join(OUTPUT_DIR, "dispensary-prices.csv");
const DEALS_CSV_PATH = path.join(OUTPUT_DIR, "dispensary-deals.csv");

const SIZE_PATTERNS = [
  { label: "1 oz", regex: /\b(?:1\s*ounce|1\s*oz|1oz|28g|28\s*g|28(?:\.0+)?\s*grams?)\b/i },
  { label: "1/2 oz", regex: /\b(?:1\/2\s*ounce|1\/2\s*oz|1\/2oz|14g|14\s*g|14(?:\.0+)?\s*grams?|half\s*ounce|0\.5\s*oz)\b/i }
];

function detectSize(text) {
  for (const pattern of SIZE_PATTERNS) {
    if (pattern.regex.test(text)) {
      return pattern.label;
    }
  }
  return null;
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
  if (url.includes("shop.newamsterdam.nyc")) {
    return "newamsterdam";
  }
  if (url.includes("conbud.com")) {
    return "conbud";
  }
  if (url.includes("gotham.nyc")) {
    return "gotham";
  }
  if (url.includes("shop.kushklub.com")) {
    return "kushklub";
  }
  if (url.includes("hwcannabis.co") || url.includes("thetravelagency.co")) {
    return "blaze";
  }
  if (url.includes("leafly.com")) {
    return "leafly";
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
      product
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

      entries.push({
        size: size.label,
        price,
        line,
        product: findPreviousLabel(lines, i)
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

  return {
    size,
    price,
    line: text,
    product: cleanText(product || size)
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

  return {
    size,
    price,
    line: clean,
    product: cleanText(product || size)
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
    .replace(/\s*(?:THC|CBD|TAC):?\s*[\d.]+%.*$/i, "")
    .replace(/\s*\d+(?:\.\d+)?%\s*(?:THC|CBD|TAC).*$/i, "")
    .replace(/^\$[\d.]+\s*\|?\s*/, "")
    .replace(/\$[\d.]+\s*\|\s*\d+\/?\d*\s*oz/i, "")
    .trim();
}

function filterListingEntries(entries) {
  return Array.from(
    new Map(
      entries
        .filter((entry) => entry && typeof entry.price === "number" && entry.product)
        .filter((entry) => !/^(deals?|featured)$/i.test(entry.product))
        .filter((entry) => !/^(?:1\s*oz|1\/2\s*oz|28\s*g|14\s*g|add\s+to\s+cart)$/i.test(entry.product.trim()))
        .filter((entry) => !/^add\s+[\d./]+\s*(?:oz|g)\s+to\s+cart$/i.test(entry.product.trim()))
        .map((entry) => {
          const product = cleanProductName(entry.product);
          return [
            `${entry.size}|${entry.price}|${product}`,
            {
              ...entry,
              product,
              line: cleanText(entry.line)
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

      return {
        size,
        price: product.price,
        line: searchableText,
        product: normalizeWhitespace(product.name)
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
  const allProducts = [];

  const responseHandler = async (response) => {
    const url = response.url();
    if (!url.includes("api.mosaic.green") || !url.includes("product-list")) {
      return;
    }
    if (url.includes("/new/product-list") || url.includes("/popular/product-list")) {
      return;
    }
    try {
      const data = await response.json();
      if (data?.products?.length) {
        allProducts.push(...data.products);
      }
    } catch {
      // Non-JSON response, skip.
    }
  };

  page.on("response", responseHandler);

  await gotoWithRetries(page, menuUrl, { attempts: 3, timeout: 90000 });
  await page.waitForTimeout(3000);

  // Scroll to trigger infinite-scroll product loading
  let previousCount = 0;
  for (let i = 0; i < 30; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
    if (allProducts.length === previousCount) {
      break;
    }
    previousCount = allProducts.length;
  }

  page.off("response", responseHandler);

  const entries = [];
  for (const product of allProducts) {
    const size = detectSize(product.name ?? "");
    if (!size) {
      continue;
    }
    const variant = product.product_variants?.[0];
    const rawPrice = variant?.price ?? variant?.base_price;
    const price = Number(rawPrice);
    if (!price || isNaN(price)) {
      continue;
    }
    entries.push({
      size,
      price,
      line: product.name,
      product: normalizeWhitespace(product.name)
    });
  }

  return filterListingEntries(entries);
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

  // Wait for products to render, then scroll to trigger lazy-loading
  await page.waitForTimeout(3500);
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1000);
  }

  // Strategy 1: extract from product card elements (common Blaze/Jane card selectors)
  const cardSelectors = [
    '[class*="product-card"]',
    '[class*="ProductCard"]',
    '[class*="menu-item"]',
    '[class*="MenuItem"]',
    '[data-testid*="product"]',
    'li[class*="product"]',
    'article'
  ];
  const entries = [];
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

  // Strategy 2: full body text fallback
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
    result.status = (result.ounceListings.length > 0 || result.halfOunceListings.length > 0) ? "ok" : "no_target_sizes";
    if (result.status === "no_target_sizes") {
      result.error = `Menu loaded, but no 1 oz or 1/2 oz flower listings were found. Flower products seen: ${result.flowerProducts}.`;
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

  const STORE_TIMEOUT_MS = 30000;

  const results = [];
  for (const dispensary of dispensaries) {
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          ...dispensary,
          menuUrl: dispensary.menuUrlOverride ?? null,
          dealsUrl: dispensary.dealsUrlOverride ?? null,
          status: "timeout",
          ounceListings: [],
          halfOunceListings: [],
          deals: [],
          error: `Scrape timed out after ${STORE_TIMEOUT_MS / 1000}s`,
          totalProducts: 0,
          flowerProducts: 0,
          provider: "unknown"
        });
      }, STORE_TIMEOUT_MS);
    });
    const result = await Promise.race([scrapeStore(page, dispensary), timeoutPromise]);
    results.push(result);
    const skipReason = (result.status === "skipped" || result.status === "no_target_sizes" || result.status === "menu_error" || result.status === "timeout")
      ? ` | reason: ${result.error ?? result.sourceNote ?? "unknown"}`
      : "";
    console.log(`${result.name}: ${result.status} | oz=${result.ounceListings.length} | half=${result.halfOunceListings.length} | deals=${result.deals.length}${skipReason}`);
  }

  await browser.close();

  const summary = results.map((result) => {
    const ounceSummary = summarizeEntries(result.ounceListings, "1 oz");
    const halfSummary = summarizeEntries(result.halfOunceListings, "1/2 oz");
    return {
      ...result,
      cheapestOunce: ounceSummary.lowest,
      cheapestHalfOunce: halfSummary.lowest
    };
  });

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
      "menu_url",
      "source_note"
    ],
    ...summary.flatMap((result) => {
      const rows = [];
      for (const entry of [...result.ounceListings, ...result.halfOunceListings]) {
        rows.push([
          result.name,
          result.address,
          result.neighborhood,
          result.status,
          entry.size,
          entry.price,
          entry.product,
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
