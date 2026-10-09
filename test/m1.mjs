// M1 proof: terrain loads, fire ignites and spreads, motion is real.
// Usage: node test/m1.mjs <url> [chromium|webkit|firefox]
import { chromium, webkit, firefox } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:4173";
const engine = process.argv[3] ?? "chromium";
mkdirSync("test/results", { recursive: true });

const browser = await { chromium, webkit, firefox }[engine].launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(2600); // let the reveal finish

await page.screenshot({ path: `test/results/m1-load-${engine}.png` });

// ignite near center and run 6 sim-seconds
await page.evaluate(() => window.__yesca.ignite(0.5, 0.5));
const s0 = await page.evaluate(() => window.__yesca.stats());
await page.waitForTimeout(1500);
const s1 = await page.evaluate(() => window.__yesca.stats());
await page.waitForTimeout(4500);
const s2 = await page.evaluate(() => window.__yesca.stats());
await page.screenshot({ path: `test/results/m1-burn-${engine}.png` });

// motion check: two frames a second apart must differ
const f1 = await page.screenshot();
await page.waitForTimeout(1000);
const f2 = await page.screenshot();
const moving = !f1.equals(f2);

console.log(
  JSON.stringify(
    { engine, s0, s1, s2, moving, errors },
    null,
    1,
  ),
);
await browser.close();

const ok =
  errors.length === 0 &&
  moving &&
  (s2.burning > 0 || s2.burnt > 0) &&
  s2.burnt + s2.burning > s1.burnt + s1.burning;
console.log(ok ? "M1 PASS" : "M1 FAIL");
process.exit(ok ? 0 : 1);
