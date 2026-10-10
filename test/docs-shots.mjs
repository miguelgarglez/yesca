// docs/ evidence set: hero, strike, burn, overlay, tray, share, mobile
// current chrome: dock + engraved guide; instruments are hidden during the
// tour, so skip it first; the share control is the chip (needs a real burn)
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4421/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(url);
await page.waitForFunction(() => window.__yesca && window.__yesca.stats, null, { timeout: 45000 });
await page.waitForSelector(".guide", { state: "visible", timeout: 40000 });
await page.waitForTimeout(1400); // mid-entrance settle: land + lesson + dock
await page.screenshot({ path: "docs/m3-hero.png" });

// tour off, tools armed
await page.click(".g-skip");
await page.waitForTimeout(800);

// strike a match across the mid-slope
await page.click('button[data-tool="match"]');
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

// firebreak + real-burns overlay
await page.click('button[data-tool="break"]');
await page.mouse.move(900, 300);
await page.mouse.down();
await page.mouse.move(620, 560, { steps: 24 });
await page.mouse.up();
await page.click('button.lever:has-text("real burns")');
await page.waitForTimeout(1500);
await page.screenshot({ path: "docs/m3-burns-overlay.png" });
await page.click('button.lever:has-text("real burns")'); // toggle back off

// place tray
await page.click(".place-btn");
await page.waitForSelector(".placetray", { timeout: 8000 });
await page.waitForTimeout(800);
await page.screenshot({ path: "docs/m3-tray.png" });
await page.keyboard.press("Escape");
await page.waitForTimeout(600);

// share sheet via the chip — seed a burn first so the chip is mounted
await page.evaluate(() => {
  const y = window.__yesca;
  for (const [u, v] of [[0.5, 0.5], [0.52, 0.51], [0.48, 0.5], [0.5, 0.53]]) y.ignite(u, v);
});
await page.waitForSelector(".sharechip", { timeout: 60000 });
await page.click(".sharechip");
await page.waitForSelector(".sheet", { timeout: 8000 });
await page.waitForTimeout(900);
await page.screenshot({ path: "docs/m3-share.png" });
await page.keyboard.press("Escape");
await page.close();

// mobile: post-tour frame with a live burn
const mp = await browser.newPage({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
mp.on("pageerror", (e) => errors.push("m:" + e.message));
await mp.goto(url);
await mp.waitForFunction(() => window.__yesca && window.__yesca.stats, null, { timeout: 45000 });
await mp.waitForSelector(".guide", { state: "visible", timeout: 40000 });
await mp.waitForTimeout(900);
await mp.click(".g-skip");
await mp.waitForTimeout(700);
await mp.evaluate(() => {
  const y = window.__yesca;
  for (let i = 0; i < 14; i++) y.ignite(0.5 + (i - 7) * 0.005, 0.5 + ((i * 7) % 5) * 0.005);
});
await mp.waitForTimeout(9000);
await mp.screenshot({ path: "docs/m3-mobile.png" });
await mp.close();

console.log("errors:", JSON.stringify(errors));
await browser.close();
