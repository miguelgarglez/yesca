// docs/ evidence set: hero, strike, burn, overlay, tray, share, mobile
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:4766/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(url);
await page.waitForSelector(".instruments", { timeout: 40000 });
await page.waitForTimeout(3500);
await page.screenshot({ path: "docs/m3-hero.png" });

// strike a match across the mid-slope
await page.mouse.move(620, 480);
await page.mouse.down();
for (let i = 1; i <= 9; i++) {
  await page.mouse.move(620 + i * 22, 480 - i * 9, { steps: 3 });
  await page.waitForTimeout(35);
}
await page.screenshot({ path: "docs/m3-strike-mid.png" }); // scratch trail, before release
await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: "docs/m3-flare.png" });
await page.waitForTimeout(16000);
await page.screenshot({ path: "docs/m3-burn.png" });

// firebreak + overlay
await page.click('[data-tool="break"]');
await page.mouse.move(900, 300);
await page.mouse.down();
await page.mouse.move(620, 560, { steps: 24 });
await page.mouse.up();
await page.click('button.lever:has-text("real burns")');
await page.waitForTimeout(1500);
await page.screenshot({ path: "docs/m3-burns-overlay.png" });

// place tray
await page.click(".place-btn");
await page.waitForTimeout(800);
await page.screenshot({ path: "docs/m3-tray.png" });
await page.keyboard.press("Escape");

// share sheet
await page.click('button.lever:has-text("share")');
await page.waitForTimeout(1500);
await page.screenshot({ path: "docs/m3-share.png" });
await page.keyboard.press("Escape");

// mobile
const mp = await browser.newPage({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
mp.on("pageerror", (e) => errors.push("m:" + e.message));
await mp.goto(url);
await mp.waitForSelector(".instruments", { timeout: 40000 });
await mp.waitForTimeout(3000);
await mp.screenshot({ path: "docs/m3-mobile.png" });

console.log("errors:", JSON.stringify(errors));
await browser.close();
