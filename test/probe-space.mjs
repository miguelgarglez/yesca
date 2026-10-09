import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(4500); // let the reveal finish
const before = await page.evaluate(() => ({
  step: document.querySelector(".g-line")?.textContent,
  canvasTool: document.querySelector("canvas.stage")?.dataset.tool,
  lit: document.querySelector(".tbtn.on")?.dataset.tool,
  cursor: getComputedStyle(document.querySelector("canvas.stage")).cursor,
  burning: window.__yesca.stats().burning,
}));
await page.keyboard.press(" "); // the r7 exploit: Space during step 1
await page.waitForTimeout(1200);
const after = await page.evaluate(() => ({
  step: document.querySelector(".g-line")?.textContent,
  burning: window.__yesca.stats().burning,
}));
console.log("before:", JSON.stringify(before));
console.log("after space:", JSON.stringify(after));
// now do the orbit lesson for real — step should advance to strike
await page.mouse.move(640, 100);
await page.mouse.down();
for (let i = 0; i < 16; i++) { await page.mouse.move(640 + i * 18, 100); await page.waitForTimeout(50); }
await page.mouse.up();
await page.waitForFunction(() => document.querySelector(".g-line")?.textContent.includes("match"), { timeout: 8000 });
const s2 = await page.evaluate(() => ({
  step: document.querySelector(".g-line")?.textContent,
  lit: document.querySelector(".tbtn.on")?.dataset.tool,
  canvasTool: document.querySelector("canvas.stage")?.dataset.tool,
}));
console.log("after orbit:", JSON.stringify(s2));
await b.close();
