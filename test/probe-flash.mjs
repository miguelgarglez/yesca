import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(1500);
// click "rain" tool, check flash position vs button
await page.click('[data-tool="rain"]');
await page.waitForTimeout(120);
const r1 = await page.evaluate(() => {
  const f = document.querySelector(".toolflash");
  const btn = document.querySelector('[data-tool="rain"]').getBoundingClientRect();
  return f ? { flashX: f.getBoundingClientRect().left + f.getBoundingClientRect().width / 2, btnX: btn.left + btn.width / 2 } : null;
});
console.log("rain:", JSON.stringify(r1));
// rapid re-switch: flash should restart (still visible ~1s later after second click)
await page.click('[data-tool="break"]');
await page.waitForTimeout(1100);
const alive = await page.evaluate(() => !!document.querySelector(".toolflash"));
console.log("still visible 1.1s after second switch (timer restarted):", alive);
await page.waitForTimeout(500);
console.log("gone after:", await page.evaluate(() => !document.querySelector(".toolflash")));
await b.close();
