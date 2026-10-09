import { chromium } from "playwright";
const ctx = await chromium.launch().then(b => b.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: "/tmp/yesca-vid", size: { width: 1280, height: 800 } },
}));
const page = await ctx.newPage();
const url = process.argv[2] ?? "http://localhost:4421";
await page.goto(url);
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(2600); // reveal settles
// a real match strike: pick the match tool, drag a scratch, release
await page.keyboard.press("2");
await page.mouse.move(560, 430);
await page.mouse.down();
for (let i = 0; i <= 12; i++) {
  await page.mouse.move(560 + i * 6, 430 - i * 3);
  await page.waitForTimeout(40);
}
await page.mouse.up();
await page.waitForTimeout(6500); // watch the front run
await ctx.close();
console.log("done");
