import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 375, height: 740 } });
const page = await ctx.newPage();
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(2500);
const meas = async (tag) => {
  const r = await page.evaluate(() => {
    const skip = document.querySelector(".g-skip")?.getBoundingClientRect();
    const line = document.querySelector(".g-line")?.getBoundingClientRect();
    const guide = document.querySelector(".guide")?.getBoundingClientRect();
    return { skip: skip && { l: skip.left, r: skip.right }, line: line && { r: line.right }, guide: guide && { r: guide.right, h: guide.height } };
  });
  console.log(tag, JSON.stringify(r), "viewport 375");
  return r;
};
await page.screenshot({ path: "/tmp/mg-step1.png" });
await meas("step1");
// orbit: drag on the void (left edge, off-terrain)
await page.mouse.move(30, 200); await page.mouse.down();
for (let i = 1; i <= 14; i++) { await page.mouse.move(30 + i * 6, 200 - i * 4); await page.waitForTimeout(55); }
await page.mouse.up();
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/mg-step2.png" });
await meas("step2");
// strike: drag on terrain
await page.mouse.move(190, 380); await page.mouse.down();
for (let i = 1; i <= 14; i++) { await page.mouse.move(190 + i * 5, 380 + i * 3); await page.waitForTimeout(55); }
await page.mouse.up();
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/mg-step3.png" });
await meas("step3");
await b.close();
