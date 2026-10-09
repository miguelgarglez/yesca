// Capture the six video beats as separate webm clips from the real product.
// Usage: node video/capture.mjs <url>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:4421";
const OUT = "video/footage";
mkdirSync(OUT, { recursive: true });

async function clip(name, fn, { guide = false } = {}) {
  const ctx = await chromium.launch().then((b) =>
    b.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
      recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
    }),
  );
  const page = await ctx.newPage();
  if (!guide) await page.addInitScript(() => localStorage.setItem("yesca.guide.v1", "1"));
  await page.goto(url);
  await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
  await fn(page);
  await ctx.close(); // closing flushes the webm
  console.log("captured", name);
}

const drag = async (page, x0, y0, dx, dy, steps = 14, delay = 55) => {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + (dx * i) / steps, y0 + (dy * i) / steps);
    await page.waitForTimeout(delay);
  }
  await page.mouse.up();
};

const SKIP = new Set(process.argv[3] ? process.argv[3].split(",") : []);
const keep = (n) => !SKIP.size || SKIP.has(n);

// beat 1: cold open — relief rises out of the dark, guide appears
if (keep("beat1-open")) await clip("beat1-open", async (page) => {
  await page.waitForTimeout(5200);
}, { guide: true });

// beat 2: orbit — drag the darkness, the land tilts
if (keep("beat2-orbit")) await clip("beat2-orbit", async (page) => {
  await page.waitForTimeout(1200);
  await drag(page, 640, 380, 150, -60, 16, 70);
  await page.waitForTimeout(1400);
});

// beat 3: the match — scratch, sparks, flare, ignition
if (keep("beat3-strike")) await clip("beat3-strike", async (page) => {
  await page.waitForTimeout(1400);
  await page.keyboard.press("2");
  await page.waitForTimeout(500);
  await drag(page, 540, 450, 110, -70, 12, 75);
  await page.waitForTimeout(4200);
});

// beat 4: fire runs downwind while the instruments tick
if (keep("beat4-burn")) await clip("beat4-burn", async (page) => {
  await page.evaluate(() => window.__yesca.ignite(0.52, 0.55));
  await page.waitForTimeout(9000);
});

// beat 5: tools — firebreak carve, then rain
if (keep("beat5-tools")) await clip("beat5-tools", async (page) => {
  await page.evaluate(() => window.__yesca.ignite(0.5, 0.58));
  await page.waitForTimeout(2500);
  await page.keyboard.press("3");
  await page.waitForTimeout(400);
  await drag(page, 470, 330, 60, 160, 12, 65);
  await page.keyboard.press("4");
  await page.waitForTimeout(300);
  await drag(page, 700, 300, -40, 180, 10, 70);
  await page.waitForTimeout(2500);
});

// beat 6: real burns — NASA diamonds fade in
if (keep("beat6-real")) await clip("beat6-real", async (page) => {
  await page.waitForTimeout(1500);
  await page.click(".rail .lever", { position: { x: 20, y: 10 } }).catch(() => {});
  await page.waitForTimeout(4500);
});

console.log("all beats captured");
