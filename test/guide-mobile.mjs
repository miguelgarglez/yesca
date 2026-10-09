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
    const text = document.querySelector(".g-line")?.textContent ?? "";
    return { text, skip: skip && { l: skip.left, r: skip.right }, line: line && { r: line.right }, guide: guide && { r: guide.right, h: guide.height } };
  });
  console.log(tag, JSON.stringify(r), "viewport 375");
  if (r.skip && r.skip.r > 375) throw new Error(`skip clipped at ${tag}: ${r.skip.r}`);
  return r;
};
const s1 = await meas("step1");
if (!s1.text.includes("land tilts")) throw new Error("step1 not the orbit copy");
await page.screenshot({ path: "docs/mg-step1.png" });
// orbit: drag along the top-right sky strip — must not touch terrain or the masthead
await page.mouse.move(340, 110); await page.mouse.down();
for (let i = 1; i <= 14; i++) { await page.mouse.move(340 - i * 9, 110); await page.waitForTimeout(55); }
await page.mouse.up();
await page.waitForFunction(() => document.querySelector(".g-line")?.textContent.includes("match"), { timeout: 5000 });
await page.waitForTimeout(800);
await page.screenshot({ path: "docs/mg-step2.png" });
await meas("step2");
// strike: drag on terrain — only possible now that step 2 taught it
await page.mouse.move(190, 380); await page.mouse.down();
for (let i = 1; i <= 14; i++) { await page.mouse.move(190 + i * 5, 380 + i * 3); await page.waitForTimeout(55); }
await page.mouse.up();
await page.waitForFunction(() => document.querySelector(".g-line")?.textContent.includes("cannot cross"), { timeout: 5000 });
await page.waitForTimeout(800);
await page.screenshot({ path: "docs/mg-step3.png" });
await meas("step3");
console.log("GUIDE MOBILE PASS");
await b.close();
