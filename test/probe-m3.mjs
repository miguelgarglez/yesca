// M3 interaction probe: strike, guide, place switch, overlay, share card.
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4178/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(url);
await page.waitForSelector(".instruments", { timeout: 30000 });
await page.waitForTimeout(3000);

// step 1: orbit the terrain to advance the guide
await page.mouse.move(640, 380);
await page.mouse.down();
await page.mouse.move(760, 320, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/y-m3-guide2.png" });

// step 2: match strike — press and drag on the terrain
const y = await page.evaluate(() => {
  const c = document.querySelector("canvas.stage");
  const r = c.getBoundingClientRect();
  return r.height / 2;
});
await page.mouse.move(560, y + 40);
await page.mouse.down();
for (let i = 0; i <= 10; i++) {
  await page.mouse.move(560 + i * 16, y + 40 + Math.sin(i) * 6, { steps: 2 });
  await page.waitForTimeout(40);
}
await page.mouse.up();
await page.waitForTimeout(400);
await page.screenshot({ path: "/tmp/y-m3-strike.png" });

// let the fire breathe
await page.waitForTimeout(12000);
await page.screenshot({ path: "/tmp/y-m3-burn.png" });
const stats = await page.evaluate(() => window.__yesca.stats());
console.log("stats", JSON.stringify(stats));

// guide should be done or on wind step
await page.waitForTimeout(5000);
await page.screenshot({ path: "/tmp/y-m3-after.png" });

// real burns toggle
await page.click('button.lever:has-text("real burns")');
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/y-m3-burns.png" });

// place picker
await page.click(".place-btn");
await page.waitForTimeout(600);
await page.screenshot({ path: "/tmp/y-m3-tray.png" });
// switch to San Gabriels via gazetteer
const clicked = await page.evaluate(() => {
  const btns = [...document.querySelectorAll(".placetray .pt-gaz button")];
  const b = btns.find((x) => x.textContent.includes("San Gabriels"));
  if (b) { b.click(); return true; }
  return false;
});
console.log("picked LA:", clicked);
await page.waitForTimeout(6000);
await page.screenshot({ path: "/tmp/y-m3-la.png" });
const hash = await page.evaluate(() => location.hash);
console.log("hash:", hash);

// share sheet
await page.click('button.lever:has-text("share")');
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/y-m3-share.png" });
await page.keyboard.press("Escape");

console.log("errors:", JSON.stringify(errors));
await browser.close();
