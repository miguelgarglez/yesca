import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(2800);
await page.screenshot({ path: "docs/r4-guide.png" });
await page.mouse.move(660, 340); await page.mouse.down();
for (let i = 1; i <= 12; i++) { await page.mouse.move(660 + i * 7, 340 - i * 3); await page.waitForTimeout(50); }
await page.mouse.up();
await page.waitForTimeout(900);
await page.screenshot({ path: "docs/r4-stroke.png" });
await b.close();
