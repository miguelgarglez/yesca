import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", e => console.log("PAGEERROR:", e.message));
page.on("console", m => m.type() === "error" && console.log("CONSOLE:", m.text().slice(0,120)));
await page.addInitScript(() => localStorage.setItem("yesca.guide.v1", "1"));
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(2500);
await page.evaluate(() => { for (const [u,v] of [[0.48,0.46],[0.5,0.48],[0.52,0.5],[0.5,0.44],[0.46,0.52]]) window.__yesca.ignite(u,v); });
// wait until burn is big enough for the chip
for (let w = 0; w < 30; w++) {
  const chip = await page.evaluate(() => !!document.querySelector(".sharechip"));
  if (chip) break;
  await page.waitForTimeout(5000);
}
await page.click(".sharechip");
await page.waitForSelector(".sheet-actions a", { timeout: 8000 }).catch(() => console.log("no download link — capture failed?"));
await page.waitForTimeout(400);
console.log(await page.evaluate(() => ({
  active: document.activeElement?.tagName + "." + document.activeElement?.className,
  hasImg: !!document.querySelector(".sheet-actions a"),
})));
await b.close();
