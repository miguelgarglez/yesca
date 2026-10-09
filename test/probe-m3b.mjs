// M3b: firebreak, rain, deep-link hash, mobile 375px
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4178/";
const browser = await chromium.launch();
const errors = [];

// deep-link: Vesuvius
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url + "#40.8214,14.4260");
  await page.waitForSelector(".instruments", { timeout: 30000 });
  await page.waitForTimeout(2500);
  const name = await page.textContent(".place-btn");
  console.log("deeplink place:", name);
  await page.screenshot({ path: "/tmp/y-vesuvius.png" });

  // strike, then firebreak across its path
  await page.evaluate(() => window.__yesca.ignite(0.45, 0.45));
  await page.waitForTimeout(6000);
  await page.click('[data-tool="break"]');
  await page.mouse.move(400, 320);
  await page.mouse.down();
  await page.mouse.move(880, 340, { steps: 30 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  await page.screenshot({ path: "/tmp/y-break.png" });

  // rain tool
  await page.click('[data-tool="rain"]');
  await page.mouse.move(560, 360);
  await page.mouse.down();
  await page.mouse.move(640, 380, { steps: 8 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: "/tmp/y-rain.png" });
  await page.mouse.up();
  await page.close();
}

// mobile
{
  const page = await browser.newPage({ viewport: { width: 375, height: 667 } });
  page.on("console", (m) => m.type() === "error" && errors.push(`m:${m.text()}`));
  page.on("pageerror", (e) => errors.push(`m:${e.message}`));
  await page.goto(url);
  await page.waitForSelector(".instruments", { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "/tmp/y-mobile.png" });
  await page.close();
}
console.log("errors:", JSON.stringify(errors));
await browser.close();
