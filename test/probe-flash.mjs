import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => localStorage.setItem("yesca.guide.v1", "1"));
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(4000);
// Enter/Space auto-orbit path: focus body, press a tool key then Enter path — test the orbit-btn anchor
const ob = await page.evaluate(() => {
  const r = document.querySelector('.tbtn[data-tool="orbit"]').getBoundingClientRect();
  return { cx: r.left + r.width / 2 };
});
await page.keyboard.press("3");
await page.waitForTimeout(80);
const f1 = await page.evaluate(() => {
  const el = document.querySelector(".toolflash");
  if (!el) return null;
  return { left: parseFloat(el.style.left), top: parseFloat(el.style.top) };
});
console.log("orbit cx:", JSON.stringify(ob), "flash(3):", JSON.stringify(f1));
await page.keyboard.press("1");
await page.waitForTimeout(80);
const f2 = await page.evaluate(() => {
  const el = document.querySelector(".toolflash");
  return el ? { left: parseFloat(el.style.left) } : null;
});
const oc = await page.evaluate(() => {
  const r = document.querySelector('.tbtn[data-tool="orbit"]').getBoundingClientRect();
  return r.left + r.width / 2;
});
console.log("flash(1->orbit) left:", JSON.stringify(f2), "orbit cx:", oc);
// lever haptics/min-height on mobile is CSS — check lever hit target at 375px
const mp = await b.newPage({ viewport: { width: 375, height: 700 } });
await mp.addInitScript(() => localStorage.setItem("yesca.guide.v1", "1"));
await mp.goto("http://localhost:4421");
await mp.waitForFunction(() => window.__yesca, { timeout: 45000 });
await mp.waitForTimeout(3500);
const lh = await mp.evaluate(() =>
  [...document.querySelectorAll(".rail .lever")].map(l => Math.round(l.getBoundingClientRect().height)));
console.log("mobile lever heights:", JSON.stringify(lh));
await b.close();
