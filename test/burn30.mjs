import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await page.addInitScript(() => localStorage.setItem("yesca.guide.v1", "1"));
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.evaluate(() => window.__yesca.ignite(0.5, 0.45));
// let it burn until there's real char
for (let i = 0; i < 15; i++) {
  await page.waitForTimeout(3000);
  const s = await page.evaluate(() => window.__yesca.stats());
  if (s.burnt > 0.01) { console.log("char at iter", i, JSON.stringify(s)); break; }
}
await page.waitForTimeout(15000);
const s = await page.evaluate(() => window.__yesca.stats());
console.log("final", JSON.stringify(s));
await page.screenshot({ path: "/tmp/burn-established.png" });
await b.close();
