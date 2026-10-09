// Step 7.4: prove the sim actually MOVES — 5 stills 1s apart while burning.
import { chromium, webkit, firefox } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://127.0.0.1:4766/";
const engine = process.argv[3] ?? "chromium";
mkdirSync("test/results", { recursive: true });

const browser = await { chromium, webkit, firefox }[engine].launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__yesca, { timeout: 60000 });
await page.waitForTimeout(2500);
await page.evaluate(() => window.__yesca.ignite(0.5, 0.48));
await page.waitForTimeout(5000);

const stats0 = await page.evaluate(() => window.__yesca.stats());
const shots = [];
for (let i = 0; i < 5; i++) {
  shots.push(await page.screenshot({ path: `test/results/motion-${engine}-${i}.png` }));
  await page.waitForTimeout(1000);
}
const stats1 = await page.evaluate(() => window.__yesca.stats());
// count bytes that differ between consecutive frames
let changed = 0;
for (let i = 1; i < shots.length; i++) {
  const a = shots[i - 1], b = shots[i];
  if (a.length !== b.length) { changed += Math.abs(a.length - b.length); continue; }
  for (let j = 0; j < a.length; j += 7) if (a[j] !== b[j]) changed++;
}
console.log(JSON.stringify({ engine, stats0, stats1, diffBytes: changed, errors }));
const ok = errors.length === 0 && changed > 5000 && stats1.burning + stats1.burnt > stats0.burning + stats0.burnt;
console.log(ok ? `MOTION ${engine.toUpperCase()} PASS` : `MOTION ${engine.toUpperCase()} FAIL`);
process.exit(ok ? 0 : 1);
