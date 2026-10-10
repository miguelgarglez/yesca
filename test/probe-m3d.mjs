// M3d: whisper on burnt scar, wind anisotropy, 1024x600 fit
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://127.0.0.1:4766/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.setItem("yesca.guide.v1", "1"));
await page.goto(url);
await page.waitForSelector(".instruments", { timeout: 40000 });
await page.waitForTimeout(2000);

// ignite center, run long enough to get a real scar
await page.evaluate(() => window.__yesca.ignite(0.5, 0.5));
await page.waitForTimeout(25000);
await page.screenshot({ path: "/tmp/y-1024.png" });

// measure anisotropy: distance from seed to furthest burning/burnt cell along vs against wind
const aniso = await page.evaluate(() => {
  const s = window.__yesca.sim;
  const wind = s.wind; // scene space east+, north+
  // scan a grid of cells
  let downwind = 0, upwind = 0;
  const seen = { dn: 0, up: 0 };
  for (let i = -140; i <= 140; i += 4) {
    // +x east, +y north in scene = (du, dv) with v down => north is -v
    const cD = window.__yesca.cell(0.5 + (i / 768) * wind.x, 0.5 - (i / 768) * wind.y);
    const cU = window.__yesca.cell(0.5 - (i / 768) * wind.x, 0.5 + (i / 768) * wind.y);
    if (cD[0] > 0.5) { seen.dn = Math.abs(i); downwind = Math.max(downwind, Math.abs(i)); }
    if (cU[0] > 0.5) { seen.up = Math.abs(i); upwind = Math.max(upwind, Math.abs(i)); }
  }
  return { wind, downwindPx: downwind, upwindPx: upwind };
});
console.log("anisotropy:", JSON.stringify(aniso));

// whisper on the scar
const xy = await page.evaluate(() => {
  for (let u = 0.35; u < 0.66; u += 0.015)
    for (let v = 0.35; v < 0.66; v += 0.015) {
      const c = window.__yesca.cell(u, v);
      if (c[0] >= 1.5 && c[2] > 0) {
        const s = window.__yesca.stage;
        const p = s.worldAt(u, v);
        p.project(s.camera);
        return { sx: (p.x * 0.5 + 0.5) * innerWidth, sy: (-p.y * 0.5 + 0.5) * innerHeight };
      }
    }
  return null;
});
console.log("scar pt:", JSON.stringify(xy));
if (xy) {
  await page.mouse.move(xy.sx, xy.sy);
  await page.waitForTimeout(400);
  await page.mouse.move(xy.sx + 3, xy.sy + 2);
  await page.waitForTimeout(500);
  const chip = await page.evaluate(() => document.querySelector(".hoverchip")?.textContent ?? null);
  console.log("whisper:", chip);
  await page.screenshot({ path: "/tmp/y-whisper.png" });
}
console.log("errors:", JSON.stringify(errors));
await browser.close();
