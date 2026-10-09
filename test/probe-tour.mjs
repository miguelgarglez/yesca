import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(2500);
const during = await page.evaluate(() => ({
  lit: document.querySelector(".tbtn.on")?.dataset.tool,
  railOp: getComputedStyle(document.querySelector(".rail")).opacity,
  instOp: getComputedStyle(document.querySelector(".instruments")).opacity,
}));
console.log("during tour:", JSON.stringify(during));
// complete the tour: orbit drag in the void, strike, break
await page.mouse.move(640, 100);
await page.mouse.down();
for (let i = 0; i < 14; i++) { await page.mouse.move(640 + i * 20, 100); await page.waitForTimeout(50); }
await page.mouse.up();
await page.waitForFunction(() => document.querySelector(".g-line")?.textContent.includes("match"), { timeout: 8000 });
await page.mouse.move(600, 420); await page.mouse.down();
for (let i = 0; i < 14; i++) { await page.mouse.move(600 + i * 8, 420 - i * 5); await page.waitForTimeout(40); }
await page.mouse.up();
await page.waitForFunction(() => document.querySelector(".g-line")?.textContent.includes("cross"), { timeout: 8000 });
await page.keyboard.press("3"); await page.waitForTimeout(200);
await page.mouse.move(700, 300); await page.mouse.down();
for (let i = 0; i < 12; i++) { await page.mouse.move(700, 300 + i * 14); await page.waitForTimeout(40); }
await page.mouse.up();
await page.waitForFunction(() => !document.querySelector(".guide"), { timeout: 8000 });
await page.waitForTimeout(1600); // hud-in delay+run
const after = await page.evaluate(() => ({
  railOp: getComputedStyle(document.querySelector(".rail")).opacity,
  instOp: getComputedStyle(document.querySelector(".instruments")).opacity,
  lit: document.querySelector(".tbtn.on")?.dataset.tool,
}));
console.log("after tour:", JSON.stringify(after));
await b.close();
