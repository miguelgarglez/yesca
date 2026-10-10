import { chromium } from "playwright";
const b = await chromium.launch();
const D = "/Users/miguelgarglez/Developer/_lab/runs/20261009-102148-l1/design/";

// guide during step 1 — nudge toggle + kb hint visible
const page = await b.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(3000);
await page.keyboard.press("Tab");
await page.waitForTimeout(400);
await page.screenshot({ path: D + "r10-guide-kb.png" });

// dock close-up: ember pip selection
const dock = await page.evaluate(() => document.querySelector(".tray")?.getBoundingClientRect());
if (dock) await page.screenshot({ path: D + "r10-dock.png", clip: { x: dock.x - 20, y: dock.y - 60, width: dock.width + 40, height: dock.height + 80 } });

// finish tour, burn, share sheet with clipboard failure
await page.evaluate(() => document.activeElement?.blur());
for (let i = 0; i < 8; i++) { await page.keyboard.press("Enter"); await page.waitForTimeout(130); }
await page.waitForFunction(() => document.querySelector(".g-line")?.textContent.includes("match"), { timeout: 8000 });
await page.keyboard.press(" "); // strike — the lesson's own tool
await page.waitForFunction(() => document.querySelector(".g-line")?.textContent.includes("Cut"), { timeout: 8000 });
await page.keyboard.press(" "); // break — tool already synced by the transition
await page.waitForTimeout(1200);
await page.evaluate(() => { for (const [u,v] of [[0.48,0.46],[0.5,0.48],[0.52,0.5],[0.5,0.44]]) window.__yesca.ignite(u,v); });
for (let w = 0; w < 24; w++) {
  if (await page.evaluate(() => !!document.querySelector(".sharechip"))) break;
  await page.waitForTimeout(5000);
}
await page.click(".sharechip");
await page.waitForSelector(".sheet", { timeout: 8000 });
await page.waitForTimeout(800);
await page.screenshot({ path: D + "r10-share.png" });
await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error("denied")); });
await page.click(".sheet-actions button");
await page.waitForTimeout(500);
await page.screenshot({ path: D + "r10-share-err.png" });
await b.close();
console.log("done");
