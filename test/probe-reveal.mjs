import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
const t0 = Date.now();
for (const ms of [200, 500, 800, 1200, 1800, 2600]) {
  const wait = ms - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: `/tmp/reveal-${ms}.png` });
}
const hudVisible = await page.evaluate(() => {
  const vis = (s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).opacity : "n/a"; };
  return { masthead: vis(".masthead"), tray: vis(".tray"), instruments: vis(".instruments"), guide: !!document.querySelector(".guide"), revealed: document.body.classList.contains("revealed") };
});
console.log(JSON.stringify(hudVisible));
await b.close();
