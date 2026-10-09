import { chromium } from "playwright";
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
const page = await ctx.newPage();
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(5500);
const r = await page.evaluate(() => ({
  masthead: getComputedStyle(document.querySelector(".masthead")).animationDuration,
  inst: getComputedStyle(document.querySelector(".instruments")).animationDuration,
  rail: getComputedStyle(document.querySelector(".rail")).animationDuration,
  tray: getComputedStyle(document.querySelector(".tray")).animationDuration,
  flash: document.querySelector(".toolflash") ? "present" : "none",
}));
console.log(JSON.stringify(r));
await b.close();
