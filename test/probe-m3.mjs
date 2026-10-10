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

// step 1: orbit the terrain to advance the guide — repeat until the lesson moves on
for (let k = 0; k < 8; k++) {
  const done = await page.evaluate(() =>
    document.querySelector(".g-line")?.textContent.includes("match"));
  if (done) break;
  await page.mouse.move(640, 380);
  await page.mouse.down();
  await page.mouse.move(760, 320, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(700);
}
await page.waitForFunction(() =>
  document.querySelector(".g-line")?.textContent.includes("match"), { timeout: 8000 });
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

// step 3: cut a firebreak — the tour ends only on the real gesture
await page.keyboard.press("3");
await page.waitForTimeout(300);
await page.mouse.move(760, 300);
await page.mouse.down();
for (let i = 1; i <= 10; i++) { await page.mouse.move(760, 300 + i * 16, { steps: 2 }); await page.waitForTimeout(40); }
await page.mouse.up();
await page.waitForFunction(() => !document.querySelector(".guide"), { timeout: 8000 });
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
// wait for the new terrain to actually land — a fixed sleep raced the fetch
await page.waitForFunction(() => !document.querySelector(".switching"), { timeout: 90000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/y-m3-la.png" });
const hash = await page.evaluate(() => location.hash);
console.log("hash:", hash);

// share sheet — the chip only exists once the hillside is scarred
await page.evaluate(() => { window.__yesca.ignite(0.5, 0.5); window.__yesca.ignite(0.42, 0.55); });
await page.waitForFunction(() => window.__yesca.stats().burnt > 0.0002, { timeout: 25000 })
  .catch(() => page.evaluate(() => window.__yesca.ignite(0.44, 0.42)));
// the chip gates on burnt > 0.004 km² — tonight's 5 km/h wind needs a while
await page.waitForSelector(".sharechip", { timeout: 90000 });
await page.click(".sharechip");
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/y-m3-share.png" });
await page.keyboard.press("Escape");

console.log("errors:", JSON.stringify(errors));
await browser.close();
