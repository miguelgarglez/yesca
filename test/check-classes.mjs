import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(2500);
await page.evaluate(() => localStorage.setItem("yesca.guide.v1", "1"));
await page.reload();
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(3000);
const s = await page.evaluate(() => ({
  railClass: document.querySelector(".rail")?.className,
  instClass: document.querySelector(".instruments")?.className,
  railOp: getComputedStyle(document.querySelector(".rail")).opacity,
  instOp: getComputedStyle(document.querySelector(".instruments")).opacity,
  railAnim: getComputedStyle(document.querySelector(".rail")).animationName,
}));
console.log(JSON.stringify(s));
await b.close();
