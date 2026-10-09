import { chromium } from "playwright";
const ctx = await chromium.launch().then(b => b.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: "/tmp/yesca-vid", size: { width: 1280, height: 800 } },
}));
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:4766/");
await page.waitForTimeout(11000);
await ctx.close();
console.log("done");
