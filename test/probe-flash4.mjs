import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(2000);
await page.evaluate(() => {
  window.__fl = [];
  let cur = null;
  new MutationObserver(() => {
    const f = !!document.querySelector(".toolflash");
    if (f !== cur) { cur = f; window.__fl.push({ t: performance.now() | 0, on: f }); }
  }).observe(document.body, { childList: true, subtree: true });
});
const c1 = Date.now(); await page.click('[data-tool="rain"]');
const c2 = Date.now(); await page.click('[data-tool="break"]');
await page.waitForTimeout(2500);
const fl = await page.evaluate(() => window.__fl);
const now = await page.evaluate(() => performance.now() | 0);
console.log("clicks at", c2 - c1, "ms apart; page now:", now);
console.log(JSON.stringify(fl));
await b.close();
