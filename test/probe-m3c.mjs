// M3c: weather truth, hover whisper, guide skip+replay, offline banner
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4178/";
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(url);
await page.waitForSelector(".instruments", { timeout: 30000 });
await page.waitForTimeout(2500);

// weather truth: HUD values vs Open-Meteo for the displayed coords
const hud = await page.evaluate(() => ({
  text: document.querySelector(".instruments")?.textContent,
  hash: location.hash,
}));
const real = await page.evaluate(async () => {
  const r = await fetch(
    "https://api.open-meteo.com/v1/forecast?latitude=40.2855&longitude=-5.3003&current=wind_speed_10m,wind_direction_10m,relative_humidity_2m,temperature_2m&wind_speed_unit=kmh",
  );
  return (await r.json()).current;
});
console.log("hud:", hud.text, "| api:", JSON.stringify(real));

// strike + wait, then hover the scar for the whisper
await page.evaluate(() => window.__yesca.ignite(0.5, 0.42));
await page.waitForTimeout(9000);
// find a burnt cell: scan a few uvs for state 2
const uv = await page.evaluate(() => {
  for (let u = 0.3; u < 0.7; u += 0.02)
    for (let v = 0.3; v < 0.6; v += 0.02) {
      const c = window.__yesca.cell(u, v);
      if (c[0] >= 1.5 && c[2] > 0) return { u, v };
    }
  return null;
});
console.log("burnt cell:", JSON.stringify(uv));
if (uv) {
  // project world -> screen via stage camera
  const xy = await page.evaluate(({ u, v }) => {
    const s = window.__yesca.stage;
    const p = s.worldAt(u, v);
    p.project(s.camera);
    return { x: (p.x * 0.5 + 0.5) * innerWidth, y: (-p.y * 0.5 + 0.5) * innerHeight };
  }, uv);
  await page.mouse.move(xy.x, xy.y);
  await page.waitForTimeout(500);
  await page.mouse.move(xy.x + 2, xy.y + 1);
  await page.waitForTimeout(500);
  const chip = await page.evaluate(() => document.querySelector(".hoverchip")?.textContent ?? null);
  console.log("whisper:", chip);
  await page.screenshot({ path: "/tmp/y-whisper.png" });
}

// guide: replay via ? key, then skip
await page.keyboard.press("?");
await page.waitForTimeout(600);
const g1 = await page.evaluate(() => document.querySelector(".g-line")?.textContent);
await page.click(".g-skip");
await page.waitForTimeout(400);
const g2 = await page.evaluate(() => document.querySelector(".g-card") ? "still there" : "gone");
console.log("guide replay:", g1, "| after skip:", g2);

// offline banner
await ctx.setOffline(true);
await page.waitForTimeout(800);
await page.screenshot({ path: "/tmp/y-offline.png" });
const off = await page.evaluate(() => document.querySelector(".offline")?.textContent);
console.log("offline banner:", off);
await ctx.setOffline(false);

console.log("errors:", JSON.stringify(errors));
await browser.close();
