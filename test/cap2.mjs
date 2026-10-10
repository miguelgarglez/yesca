import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", m => console.log("  console:", m.type(), m.text().slice(0,150)));
page.on("pageerror", e => console.log("  PAGEERROR:", e.message.slice(0,200)));
await page.addInitScript(() => localStorage.setItem("yesca.guide.v1", "1"));
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(2500);
await page.evaluate(() => { for (const [u,v] of [[0.48,0.46],[0.5,0.48],[0.52,0.5]]) window.__yesca.ignite(u,v); });
for (let w = 0; w < 30; w++) {
  if (await page.evaluate(() => !!document.querySelector(".sharechip"))) break;
  await page.waitForTimeout(5000);
}
await page.click(".sharechip");
await page.waitForTimeout(1500);
console.log(await page.evaluate(() => ({
  sheet: !!document.querySelector(".sheet"),
  canvasSize: document.querySelector(".sheet canvas")?.width,
  imgLink: !!document.querySelector(".sheet-actions a"),
})));
await b.close();
