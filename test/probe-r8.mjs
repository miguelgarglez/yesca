import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", e => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(4000);

// 1. keyboard orbit completes step 1
for (let i = 0; i < 8; i++) { await page.keyboard.press("Enter"); await page.waitForTimeout(200); }
const s1 = await page.evaluate(() => document.querySelector(".g-line")?.textContent);
console.log("after 8 enters:", s1?.slice(0, 40));

// 2. finish the tour by keyboard: strike (2+space), break (3+space)
await page.waitForFunction(() => document.querySelector(".g-line")?.textContent.includes("match"), { timeout: 8000 });
await page.keyboard.press("2"); await page.waitForTimeout(200);
await page.keyboard.press(" "); await page.waitForTimeout(1500);
const s2 = await page.evaluate(() => document.querySelector(".g-line")?.textContent);
console.log("after strike:", s2?.slice(0, 40));
await page.keyboard.press("3"); await page.waitForTimeout(200);
await page.keyboard.press(" "); await page.waitForTimeout(1500);
const s3 = await page.evaluate(() => ({
  guideGone: !document.querySelector(".guide") || document.querySelector(".guide")?.classList.contains("out"),
  lit: document.querySelector(".tbtn.on")?.dataset.tool,
}));
console.log("after break:", JSON.stringify(s3));

// 3. dimmed rail is unfocusable
await page.evaluate(() => localStorage.removeItem("yesca.guide.v1"));
await page.reload();
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(3000);
const tabCheck = await page.evaluate(() => {
  const lev = document.querySelector(".rail .lever");
  const cs = getComputedStyle(lev);
  return { vis: cs.visibility, op: cs.opacity };
});
console.log("dimmed lever:", JSON.stringify(tabCheck));

// 4. guide replay resets — press ?, confirm step 1 needs a fresh orbit
await page.evaluate(() => localStorage.setItem("yesca.guide.v1", "1"));
await page.reload();
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(3000);
await page.evaluate(() => window.__yesca.ignite(0.5, 0.5)); // prime struckOnce? (programmatic doesn't set it)
await page.keyboard.press("?"); await page.waitForTimeout(800);
const replay = await page.evaluate(() => ({
  step: document.querySelector(".g-line")?.textContent?.slice(0, 30),
  lit: document.querySelector(".tbtn.on")?.dataset.tool,
}));
console.log("replayed:", JSON.stringify(replay));
await b.close();
