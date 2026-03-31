import fs from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";

const INPUT_PATH = path.resolve("output/dispensary-prices.json");
const OUTPUT_PATH = path.resolve("output/dispensary-prices-clean.json");

// claude-haiku-4-5 pricing per million tokens
const HAIKU_INPUT_COST_PER_MTOK = 0.25;
const HAIKU_OUTPUT_COST_PER_MTOK = 1.25;

const client = new Anthropic();
// API key read from ANTHROPIC_API_KEY env var automatically

const SYSTEM_PROMPT =
  "You are a cannabis product name cleaner. Return only valid JSON — no markdown, no commentary.";

const USER_PROMPT_PREFIX = `Clean these NYC cannabis dispensary product names. For each name:
- Remove size info (14g, 28g, 3.5g, 1/8 oz, etc.)
- Remove category words (Flower, Pre-Ground, Indica, Sativa, Hybrid)
- Remove inventory warnings (e.g. "Only a few left in stock!")
- Remove storefront/UI text that isn't part of the product name
- Standardize to "Brand | Strain" format where a brand is present
- Preserve the strain name accurately

Return a JSON array of cleaned names in the same order as the input. Example:
Input:  ["ITHACA CULTIVATED | SOUR DIESEL - 14G - FLOWER", "Only a few left! Grocery - Lucky Charms - Flower"]
Output: ["Ithaca Cultivated | Sour Diesel", "Grocery | Lucky Charms"]

Names to clean:
`;

async function cleanProductNames(names) {
  if (names.length === 0) return [];

  const response = await client.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: USER_PROMPT_PREFIX + JSON.stringify(names, null, 2),
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No text block in response");

  let cleaned;
  try {
    cleaned = JSON.parse(textBlock.text);
  } catch {
    // Try to extract a JSON array if the model wrapped it in anything
    const match = textBlock.text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error(`Could not parse JSON from response: ${textBlock.text}`);
    cleaned = JSON.parse(match[0]);
  }

  if (!Array.isArray(cleaned) || cleaned.length !== names.length) {
    throw new Error(
      `Expected array of ${names.length} names, got: ${JSON.stringify(cleaned)}`
    );
  }

  return { cleaned, usage: response.usage };
}

function extractAllProductNames(store) {
  const sizeKeys = [
    "ounceListings",
    "halfOunceListings",
    "quarterOunceListings",
    "eighthOunceListings",
  ];
  const names = [];
  for (const key of sizeKeys) {
    for (const listing of store[key] ?? []) {
      if (listing.product) names.push(listing.product);
    }
  }
  return names;
}

function applyCleanedNames(store, originalNames, cleanedNames) {
  const nameMap = new Map();
  for (let i = 0; i < originalNames.length; i++) {
    // Last write wins — fine since duplicates clean the same way
    nameMap.set(originalNames[i], cleanedNames[i]);
  }

  const sizeKeys = [
    "ounceListings",
    "halfOunceListings",
    "quarterOunceListings",
    "eighthOunceListings",
  ];

  const updated = { ...store };
  for (const key of sizeKeys) {
    if (!updated[key]) continue;
    updated[key] = updated[key].map((listing) => ({
      ...listing,
      product: nameMap.get(listing.product) ?? listing.product,
      originalProduct: listing.product,
    }));
  }

  // Also update cheapest* summary fields
  for (const field of [
    "cheapestOunce",
    "cheapestHalfOunce",
    "cheapestQuarterOunce",
    "cheapestEighth",
  ]) {
    if (updated[field]?.product) {
      updated[field] = {
        ...updated[field],
        product: nameMap.get(updated[field].product) ?? updated[field].product,
        originalProduct: updated[field].product,
      };
    }
  }

  return updated;
}

async function main() {
  const raw = await fs.readFile(INPUT_PATH, "utf8");
  const stores = JSON.parse(raw);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const cleanedStores = [];

  for (const store of stores) {
    const originalNames = extractAllProductNames(store);
    const uniqueNames = [...new Set(originalNames)];

    if (uniqueNames.length === 0) {
      console.log(`  ${store.name}: no products, skipping`);
      cleanedStores.push(store);
      continue;
    }

    console.log(`  ${store.name}: cleaning ${uniqueNames.length} unique product names...`);

    let cleanedUnique;
    let usage;
    try {
      ({ cleaned: cleanedUnique, usage } = await cleanProductNames(uniqueNames));
      totalInputTokens += usage.input_tokens;
      totalOutputTokens += usage.output_tokens;
    } catch (err) {
      console.error(`    ERROR cleaning ${store.name}: ${err.message}`);
      console.error("    Keeping original names for this store.");
      cleanedStores.push(store);
      continue;
    }

    // Build a full-size map from uniqueNames -> cleanedUnique, then apply
    const cleanedStore = applyCleanedNames(store, uniqueNames, cleanedUnique);
    cleanedStores.push(cleanedStore);
    console.log(`    done (${usage.input_tokens} in / ${usage.output_tokens} out tokens)`);
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(cleanedStores, null, 2), "utf8");

  const inputCost = (totalInputTokens / 1_000_000) * HAIKU_INPUT_COST_PER_MTOK;
  const outputCost = (totalOutputTokens / 1_000_000) * HAIKU_OUTPUT_COST_PER_MTOK;
  const totalCost = inputCost + outputCost;

  console.log("\nDone.");
  console.log(`Output written to: ${OUTPUT_PATH}`);
  console.log(
    `Tokens used: ${totalInputTokens.toLocaleString()} input / ${totalOutputTokens.toLocaleString()} output`
  );
  console.log(
    `Estimated cost: $${inputCost.toFixed(4)} input + $${outputCost.toFixed(4)} output = $${totalCost.toFixed(4)} total`
  );
  console.log("(Haiku pricing: $0.25/MTok input, $1.25/MTok output)");
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
