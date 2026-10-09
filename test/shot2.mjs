import { chromium, webkit, firefox } from "playwright";
const engine = process.argv[3] ?? "chromium";
const url = process.argv[2] ?? "http://localhost:4178/";
const out = process.argv[4] ?? `/tmp/y-${engine}.png`;
const browser = await { chromium, webkit, firefox }[engine].launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("console", (m) => {
  if (["error", "warning"].includes(m.type())) errors.push(`[${m.type()}] ${m.text().slice(0, 300)}`);
});
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message.slice(0, 300)}`));
await page.goto(url);
await page.waitForTimeout(12000);
await page.screenshot({ path: out });
const y = await page.evaluate(() => !!window.__yesca).catch(() => "n/a");
console.log(engine, "ready:", y, JSON.stringify(errors.slice(0, 10)));
await browser.close();
