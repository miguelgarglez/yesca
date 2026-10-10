// refresh stale docs/ evidence: hero, mobile guide steps, share, mobile post-tour
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4421";
const b = await chromium.launch();
const errors = [];

// ---------- desktop hero: first view with guide + dock ----------
const page = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(url);
await page.waitForSelector(".guide", { state: "visible", timeout: 40000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: "docs/m3-hero.png" });
await page.screenshot({ path: "docs/r4-guide.png" });

// finish the tour by keyboard for a post-tour strike + burn + share
await page.keyboard.press("Tab");
await page.keyboard.press("Enter");
await page.waitForFunction(
  () => document.querySelector(".g-line")?.textContent?.includes("match"),
  null,
  { timeout: 8000 },
);
// strike mid-slope
await page.mouse.move(620, 480);
await page.mouse.down();
for (let i = 1; i <= 9; i++) {
  await page.mouse.move(620 + i * 22, 480 - i * 9, { steps: 3 });
  await page.waitForTimeout(30);
}
await page.screenshot({ path: "docs/r4-stroke.png" });
await page.mouse.up();
await page.waitForFunction(
  () => document.querySelector(".g-line")?.textContent?.includes("cross"),
  null,
  { timeout: 8000 },
);
// draw the firebreak to complete the tour
await page.mouse.move(880, 320);
await page.mouse.down();
await page.mouse.move(640, 560, { steps: 24 });
await page.mouse.up();
await page.waitForFunction(() => !document.querySelector(".guide") || document.querySelector(".guide.out"), null, {
  timeout: 8000,
});
await page.waitForTimeout(14000);
await page.screenshot({ path: "docs/r4-burn.png" });

// share sheet via the chip
await page.waitForSelector(".sharechip", { timeout: 40000 });
await page.click(".sharechip");
await page.waitForSelector(".sheet", { timeout: 8000 });
await page.waitForTimeout(800);
await page.screenshot({ path: "docs/m3-share.png" });
await page.screenshot({ path: "docs/r4-share.png" });
await page.keyboard.press("Escape");
await page.close();

// ---------- mobile: guide steps + post-tour ----------
const mp = await b.newPage({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
mp.on("pageerror", (e) => errors.push("m:" + e.message));
await mp.goto(url);
await mp.waitForSelector(".guide", { state: "visible", timeout: 40000 });
await mp.waitForTimeout(900);
await mp.screenshot({ path: "docs/mg-step1.png" });

await mp.keyboard.press("Tab");
await mp.keyboard.press("Enter");
await mp.waitForFunction(
  () => document.querySelector(".g-line")?.textContent?.includes("match"),
  null,
  { timeout: 8000 },
);
await mp.waitForTimeout(600);
await mp.screenshot({ path: "docs/mg-step2.png" });

await mp.keyboard.press(" ");
await mp.waitForFunction(
  () => document.querySelector(".g-line")?.textContent?.includes("cross"),
  null,
  { timeout: 8000 },
);
await mp.waitForTimeout(600);
await mp.screenshot({ path: "docs/mg-step3.png" });

// finish tour, burn, post-tour mobile
await mp.keyboard.press(" ");
await mp.waitForFunction(() => !document.querySelector(".guide") || document.querySelector(".guide.out"), null, {
  timeout: 8000,
});
await mp.evaluate(() => {
  const y = window.__yesca;
  for (let i = 0; i < 14; i++) y.ignite(0.5 + (i - 7) * 0.005, 0.5 + ((i * 7) % 5) * 0.005);
});
await mp.waitForTimeout(9000);
await mp.screenshot({ path: "docs/m3-mobile.png" });
await mp.screenshot({ path: "docs/mobile-r2.png" });
await mp.screenshot({ path: "docs/mobile-r2-fire.png" });
await mp.close();

console.log("errors:", JSON.stringify(errors));
await b.close();
