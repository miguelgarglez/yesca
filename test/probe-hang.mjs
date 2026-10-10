import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", e => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:4421");
await page.evaluate(() => localStorage.setItem("yesca.guide.v1", "1"));
await page.reload();
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.evaluate(() => window.__yesca.ignite(0.5, 0.5));
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(2000);
  const s = await page.evaluate(() => window.__yesca.stats()).catch(e => "EVAL-FAIL " + e.message);
  console.log(i, JSON.stringify(s));
}
// is the main thread responsive?
const t0 = Date.now();
const pong = await Promise.race([
  page.evaluate(() => "pong"),
  new Promise(r => setTimeout(() => r("BLOCKED"), 5000)),
]);
console.log("main thread:", pong, Date.now() - t0, "ms");
await page.screenshot({ path: "/tmp/hang.png", timeout: 15000 }).then(() => console.log("shot ok")).catch(e => console.log("shot fail", e.message.split("\n")[0]));
await b.close();
