import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:4766/");
await page.waitForSelector(".instruments", { timeout: 40000 });
await page.waitForTimeout(2500);
await page.mouse.move(640, 500);
await page.mouse.down();
for (let i = 1; i <= 9; i++) { await page.mouse.move(640 + i * 24, 500 - i * 8, { steps: 3 }); await page.waitForTimeout(30); }
await page.screenshot({ path: "/tmp/y-scratch2.png" });
await page.mouse.up();
await page.waitForTimeout(18000);
await page.screenshot({ path: "/tmp/y-burn2.png" });
await browser.close();
console.log("done");
