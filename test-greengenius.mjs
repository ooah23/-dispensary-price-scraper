import { chromium } from "playwright";

const menuUrl = "https://greengeniusnyc.com/stores/green-genius-nyc/products/flower";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const allProducts = [];

page.on("response", async (response) => {
  const url = response.url();
  if (!url.includes("graphql")) return;
  try {
    const json = await response.json();
    const products =
      json?.data?.filteredProducts?.products ??
      json?.data?.filteredProducts?.items ??
      [];
    if (Array.isArray(products) && products.length > 0) {
      allProducts.push(...products);
    }
  } catch {}
});

await page.goto(menuUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(4000);

for (const text of [/I am 21/i, /I'm 21/i, /Enter/i, /Yes/i, /Continue/i]) {
  try {
    const btn = page.getByText(text).first();
    if (await btn.isVisible({ timeout: 800 })) {
      await btn.click();
      await page.waitForTimeout(1500);
      break;
    }
  } catch {}
}

for (let i = 0; i < 6; i++) {
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1500);
}

if (allProducts.length > 0) {
  const p0 = allProducts[0];
  console.log("ALL keys:", Object.keys(p0));
  // Find fields that look like name/price
  const nameKeys = Object.keys(p0).filter(k => /name|title|label/i.test(k));
  const priceKeys = Object.keys(p0).filter(k => /price|cost|amount/i.test(k));
  const optKeys = Object.keys(p0).filter(k => /option|size|variant|weight/i.test(k));
  console.log("Name-like keys:", nameKeys, nameKeys.map(k => p0[k]));
  console.log("Price-like keys:", priceKeys, priceKeys.map(k => p0[k]));
  console.log("Option-like keys:", optKeys, optKeys.map(k => p0[k]));

  // Print full product as JSON
  console.log("\nFull product JSON:");
  console.log(JSON.stringify(p0, null, 2));
}

await browser.close();
