// quick screenshot + console error probe. usage: node test/shot.mjs <url> <out.png> [engine]
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4178/";
const out = process.argv[3] ?? "docs/shot.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") errors.push(`[${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForTimeout(9000);
await page.screenshot({ path: out });
console.log(JSON.stringify({ errors }, null, 2));
await browser.close();
