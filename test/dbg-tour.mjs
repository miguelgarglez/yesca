import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", e => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(3000);
await page.evaluate(() => document.activeElement?.blur());
for (let i = 0; i < 8; i++) { await page.keyboard.press("Enter"); await page.waitForTimeout(130); }
const s = () => page.evaluate(() => document.querySelector(".g-line")?.textContent?.slice(0,25) ?? "gone");
console.log("after enters:", await s());
await page.waitForTimeout(800);
console.log("settled:", await s());
await page.keyboard.press(" "); await page.waitForTimeout(1200);
console.log("after strike space:", await s());
await page.keyboard.press("3"); await page.keyboard.press(" "); await page.waitForTimeout(1500);
console.log("after break space:", await s());
console.log(await page.evaluate(() => ({ tool: document.querySelector(".tbtn.on")?.dataset.tool, canvas: document.querySelector(".stage")?.dataset.tool })));
await b.close();
