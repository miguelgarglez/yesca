// r13 verification: the cutter keeps its promise along the finger's real path,
// whispers fade instead of teleporting, entrances yield to exits, chip stays
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:4421/";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(url);
await page.waitForFunction(() => window.__yesca && window.__yesca.stats, null, { timeout: 45000 });
await page.waitForTimeout(1200);

const results = [];
const check = (name, ok, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// complete the tour for real (same proven sequence)
await page.click('button[data-tool="orbit"]');
for (let attempt = 0; attempt < 6; attempt++) {
  await page.mouse.move(600, 400);
  await page.mouse.down();
  await page.mouse.move(880, 300, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const advanced = await page.evaluate(() => {
    const el = document.querySelector(".g-line");
    return !el || el.textContent.includes("match");
  });
  if (advanced) break;
}
await page.click('button[data-tool="match"]');
await page.mouse.move(480, 420);
await page.mouse.down();
for (let i = 1; i <= 14; i++) {
  await page.mouse.move(480 + i * 16, 420 + i * 3, { steps: 2 });
  await page.waitForTimeout(30);
}
await page.mouse.up();
await page.waitForTimeout(1200);
await page.click('button[data-tool="break"]');
await page.mouse.move(760, 330);
await page.mouse.down();
await page.mouse.move(760, 500, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(1500);

// helper injected: sample fuel (R channel of fuelA) at a screen point
await page.evaluate(() => {
  window.__fuelAt = (x, y) => {
    const yx = window.__yesca;
    const p = yx.stage.pick(x, y);
    if (!p) return null;
    const N = yx.sim.fuelA.width;
    const px = Math.min(N - 1, Math.max(0, Math.round(p.u * N)));
    const py = Math.min(N - 1, Math.max(0, Math.round(p.v * N)));
    const buf = new Float32Array(4);
    yx.stage.renderer.readRenderTargetPixels(yx.sim.fuelA, px, py, 1, 1, buf);
    return { fuel: buf[0], u: p.u, v: p.v };
  };
});

// 1. the reviewer's case: a four-event flick across the slope must cut every
//    sample the finger crossed — fuel under the path, not just at the hits
const line = { x0: 340, y0: 520, x1: 940, y1: 430 };
const samples = [];
for (let i = 0; i <= 20; i++) {
  const x = line.x0 + ((line.x1 - line.x0) * i) / 20;
  const y = line.y0 + ((line.y1 - line.y0) * i) / 20;
  samples.push({ x, y });
}
const before = await page.evaluate((pts) => pts.map((s) => window.__fuelAt(s.x, s.y)?.fuel ?? null), samples);
const cuttable = before.map((f, i) => ({ f, i })).filter((s) => s.f !== null && s.f > 0.4);
// fast flick: only 4 pointermove events (steps:3) — the sparse case that failed
await page.mouse.move(line.x0, line.y0);
await page.mouse.down();
await page.mouse.move(line.x1, line.y1, { steps: 3 });
await page.mouse.up();
await page.waitForTimeout(900);
const after = await page.evaluate((pts) => pts.map((s) => window.__fuelAt(s.x, s.y)?.fuel ?? null), samples);
const cut = cuttable.filter((s) => (after[s.i] ?? 1) < 0.15);
check(
  "four-event flick cuts fuel all along the finger",
  cuttable.length > 0 && cut.length >= Math.ceil(cuttable.length * 0.9),
  `${cut.length}/${cuttable.length} fuelled samples cleared`,
);

// 2. whisper fades (not teleports) when the pointer moves off a scar
const scarHit = await page.evaluate(() => {
  const y = window.__yesca;
  for (let x = 150; x < innerWidth - 150; x += 25)
    for (let y0 = 180; y0 < innerHeight - 180; y0 += 25) {
      const p = y.stage.pick(x, y0);
      if (!p) continue;
      const c = y.cell(p.u, p.v);
      if (c && c[0] >= 1.5 && c[2] > 0) return { x, y: y0 };
    }
  return null;
});
if (scarHit) {
  await page.mouse.move(scarHit.x, scarHit.y);
  await page.waitForTimeout(400);
  const tag1 = await page.evaluate(() => document.querySelector(".hoverchip")?.textContent ?? null);
  await page.mouse.move(scarHit.x + 160, scarHit.y + 60); // off the scar
  await page.waitForTimeout(60);
  const mid = await page.evaluate(() => {
    const el = document.querySelector(".hoverchip");
    return el ? { cls: el.className, o: getComputedStyle(el).opacity } : null;
  });
  await page.waitForTimeout(300);
  const gone = await page.evaluate(() => !!document.querySelector(".hoverchip"));
  check(
    "whisper fades when leaving a scar",
    tag1 !== null && mid !== null && mid.cls.includes("out") && !gone,
    JSON.stringify({ tag1, mid, gone }),
  );
} else check("whisper fades when leaving a scar", false, "no burnt cell on screen");

// 3. dismiss during the guide entrance owns opacity — replay the tour and skip fast
await page.evaluate(() => document.querySelector(".pt-guide") ?? null);
await page.keyboard.press("?");
await page.waitForTimeout(150); // skip while hud-in-c is still arriving
const skipped = await page.evaluate(async () => {
  const skip = document.querySelector(".g-skip");
  if (skip) skip.click();
  // sample the guide's computed opacity over the next frames
  const out = [];
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    const g = document.querySelector(".guide");
    out.push(g ? { cls: g.className, o: +getComputedStyle(g).opacity, an: getComputedStyle(g).animationName } : null);
    if (!g) break;
  }
  return out;
});
const sawOutFading = skipped.some((s) => s && s.cls.includes("out") && s.o < 0.95);
const unmounted = skipped[skipped.length - 1] === null;
check(
  "skip during entrance: .out owns the fade",
  sawOutFading && unmounted,
  JSON.stringify(skipped.filter(Boolean).map((s) => ({ o: s.o, an: s.an })).slice(0, 6)),
);

// 4. share chip stays mounted while the sheet is open
await page.waitForSelector(".sharechip", { timeout: 40000 });
await page.click(".sharechip");
await page.waitForSelector(".sheet");
const chipDuring = await page.evaluate(() => !!document.querySelector(".sharechip"));
check("share chip stays mounted under the open sheet", chipDuring);

await b.close();
console.log(results.join("\n"));
const fails = results.filter((r) => r.startsWith("FAIL"));
process.exit(fails.length ? 1 : 0);
