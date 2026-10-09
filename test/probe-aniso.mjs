// anisotropy proof: force a strong east wind, ignite center, compare reach
import { chromium } from "playwright";
const url = process.argv[2] ?? "http://127.0.0.1:4766/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
await page.goto(url);
await page.waitForSelector(".instruments", { timeout: 40000 });
await page.waitForTimeout(1500);

// force a strong east wind: windVector -> scene x east+, y north+
await page.evaluate(() => {
  const s = window.__yesca.sim;
  s.wind = { x: 1, y: 0 };
  s.windAmt = 1.3;
  s.simMat.uniforms.uWind.value.set(1, 0);
  s.simMat.uniforms.uWindAmt.value = 1.3;
});
await page.evaluate(() => window.__yesca.ignite(0.5, 0.5));
await page.waitForTimeout(20000);
const r = await page.evaluate(() => {
  // march east vs west from the seed until unburnt
  const reach = (dx) => {
    for (let i = 8; i < 200; i += 4) {
      const c = window.__yesca.cell(0.5 + (dx * i) / 768, 0.5);
      if (c[0] < 0.5) return i;
    }
    return 200;
  };
  const north = () => {
    for (let i = 8; i < 200; i += 4) {
      const c = window.__yesca.cell(0.5, 0.5 - i / 768);
      if (c[0] < 0.5) return i;
    }
    return 200;
  };
  return { eastPx: reach(1), westPx: reach(-1), northPx: north() };
});
console.log("aniso:", JSON.stringify(r));
await page.screenshot({ path: "/tmp/y-aniso.png" });
await browser.close();
