import { chromium } from "playwright";
const browser = await chromium.launch();
const D = "/Users/miguelgarglez/Developer/_lab/runs/20261009-102148-l1/design/";

// desktop: established burn (halo evidence) + tray + burnt readout
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.addInitScript(() => localStorage.setItem("yesca.guide.v1", "1"));
await page.goto("http://localhost:4421");
await page.waitForSelector(".instruments", { timeout: 40000 });
await page.waitForTimeout(2500);
await page.evaluate(() => { for (const [u,v] of [[0.48,0.46],[0.5,0.48],[0.52,0.5]]) window.__yesca.ignite(u,v); });
await page.waitForTimeout(22000);
await page.screenshot({ path: D + "r9-burn.png" });
await page.screenshot({ path: D + "r9-burn-full.png" });

// tray
await page.click(".place-btn");
await page.waitForTimeout(900);
await page.screenshot({ path: D + "r9-tray.png" });
await page.keyboard.press("Escape");

// share sheet failure path can't be forced easily — capture normal sheet
await page.waitForSelector(".sharechip", { timeout: 20000 });
await page.click(".sharechip");
await page.waitForTimeout(1200);
await page.screenshot({ path: D + "r9-share.png" });
await page.close();

// mobile: post-burn with burnt readout + levers incl. nudge
const mp = await browser.newPage({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
await mp.addInitScript(() => localStorage.setItem("yesca.guide.v1", "1"));
await mp.goto("http://localhost:4421");
await mp.waitForSelector(".instruments", { timeout: 40000 });
await mp.waitForTimeout(2500);
await mp.evaluate(() => window.__yesca.ignite(0.5, 0.5));
await mp.waitForTimeout(16000);
await mp.screenshot({ path: D + "r9-mobile-burn.png" });
await browser.close();
console.log("done");
