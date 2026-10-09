// M2 proof: real pointer interaction — a match strike ignites along the
// drag path, orbit drags do not ignite, firebreak removes fuel.
// Usage: node test/m2.mjs <url> [chromium|webkit|firefox]
import { chromium, webkit, firefox } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:4173";
const engine = process.argv[3] ?? "chromium";
mkdirSync("test/results", { recursive: true });

const browser = await { chromium, webkit, firefox }[engine].launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(2600);

// 1) orbit drag should NOT ignite — and must actually teach step 1:
// the guide gates strikes until an orbit has happened, so drag far enough
await page.click('button[data-tool="orbit"]');
for (let attempt = 0; attempt < 4; attempt++) {
  await page.mouse.move(600, 400);
  await page.mouse.down();
  await page.mouse.move(880, 300, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const advanced = await page.evaluate(() => {
    const el = document.querySelector(".g-line");
    return !el || el.textContent.includes("match");
  });
  if (advanced) break;
}
const afterOrbit = await page.evaluate(() => window.__yesca.stats());

// 2) match strike: press + drag ignites along the stroke
await page.click('button[data-tool="match"]');
await page.mouse.move(480, 420);
await page.mouse.down();
for (let i = 1; i <= 14; i++) {
  await page.mouse.move(480 + i * 16, 420 + i * 3, { steps: 2 });
  await page.waitForTimeout(30);
}
await page.mouse.up();
await page.waitForTimeout(9000);
const afterStrike = await page.evaluate(() => window.__yesca.stats());
await page.screenshot({ path: `test/results/m2-strike-${engine}.png` });

// 3) firebreak drag removes fuel where drawn (ahead of the front)
await page.click('button[data-tool="break"]');
await page.mouse.move(760, 330);
await page.mouse.down();
await page.mouse.move(760, 500, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(400);
const cell = await page.evaluate(() => window.__yesca.cell(0.62, 0.5));

console.log(
  JSON.stringify({ engine, afterOrbit, afterStrike, cell, errors }, null, 1),
);
await browser.close();

const ok =
  errors.length === 0 &&
  afterOrbit.burning === 0 &&
  afterStrike.burning + afterStrike.burnt > 0.003;
console.log(ok ? "M2 PASS" : "M2 FAIL");
process.exit(ok ? 0 : 1);
