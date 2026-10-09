import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(1500);
await page.click('[data-tool="rain"]');
await page.waitForTimeout(80);
const d = await page.evaluate(() => {
  const f = document.querySelector(".toolflash");
  const btn = document.querySelector('[data-tool="rain"]').getBoundingClientRect();
  const fr = f.getBoundingClientRect();
  return { inlineLeft: f.style.left, rect: { l: fr.left, w: fr.width }, btn: { l: btn.left, w: btn.width }, transform: getComputedStyle(f).transform };
});
console.log(JSON.stringify(d));
await b.close();
