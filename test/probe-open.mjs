import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
const t0 = Date.now();
page.goto("http://localhost:4421");
for (const ms of [800, 1600, 2400, 3200, 4200, 5600]) {
  const wait = ms - (Date.now() - t0);
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: `/tmp/open-${ms}.png` }).catch(() => {});
}
await b.close();
console.log("done");
