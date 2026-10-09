// capture the share-card canvas -> public/og.png
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const url = process.argv[2] ?? "http://127.0.0.1:4766/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await page.goto(url);
await page.waitForSelector(".instruments", { timeout: 40000 });
await page.waitForTimeout(3000);
// a real strike + burn so the card shows a scar
await page.evaluate(() => window.__yesca.ignite(0.5, 0.45));
await page.waitForTimeout(12000);
await page.click('button.lever:has-text("share")');
await page.waitForTimeout(1600);
const data = await page.evaluate(() => {
  const c = document.querySelector(".sheet canvas");
  return c.toDataURL("image/png");
});
writeFileSync("public/og.png", Buffer.from(data.split(",")[1], "base64"));
console.log("og.png written");
await browser.close();
