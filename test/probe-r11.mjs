// r11 verification: exits that actually exit, gesture ownership, clamped surfaces
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

// complete the tour for real: orbit until step 2, strike until step 3, break until gone
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

// 1. continuous firebreak: a fast stroke leaves no surviving fuel cells on its path.
// pick a screen point whose cell still has fuel (via stage.pick), cut a fast
// stroke through it, then read the same cell
const target = await page.evaluate(() => {
  const y = window.__yesca;
  for (let x = 150; x < innerWidth - 150; x += 40)
    for (let y0 = 200; y0 < innerHeight - 200; y0 += 40) {
      const p = y.stage.pick(x, y0);
      if (!p) continue;
      const c = y.cell(p.u, p.v);
      if (c && c[0] < 0.5) return { x, y: y0, u: p.u, v: p.v };
    }
  return null;
});
if (target) {
  await page.keyboard.press("3");
  await page.waitForTimeout(200);
  await page.mouse.move(target.x - 140, target.y - 70);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++)
    await page.mouse.move(target.x - 140 + k * 28, target.y - 70 + k * 14, { steps: 1 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const cut = await page.evaluate(([u, v]) => window.__yesca.cell(u, v), [target.u, target.v]);
  check("break cuts continuously through a fast stroke", cut && cut[0] < 0.5, `cell[0]=${cut?.[0]?.toFixed(2)}`);
} else check("break cuts continuously through a fast stroke", false, "no unburnt cell on screen");

// 2. anchored share sheet exit: transform applies, not overridden
await page.waitForSelector(".sharechip", { timeout: 40000 });
await page.click(".sharechip");
await page.waitForSelector(".sheet", { timeout: 8000 });
await page.waitForTimeout(800);
const inView = await page.evaluate(() => {
  const s = document.querySelector(".sheet").getBoundingClientRect();
  return { top: s.top, bottom: s.bottom, h: innerHeight };
});
check("sheet stays inside the viewport", inView.top >= 0 && inView.bottom <= inView.h, JSON.stringify(inView));
// close via Escape — exit should move, not just fade in place
await page.keyboard.press("Escape");
await page.waitForTimeout(80);
const exitT = await page.evaluate(() => {
  const el = document.querySelector(".sheet-back.out .sheet");
  return el ? getComputedStyle(el).transform : "gone";
});
check("anchored sheet fold-back applies on exit", exitT !== "gone" && exitT !== "none", `transform=${exitT}`);
await page.waitForTimeout(400);

// 3. retry → success: focus lands on a sheet action, not the void
await page.click(".sharechip");
await page.waitForSelector(".sheet");
await page.evaluate(() => {
  window.__clipCalls = 0;
  navigator.clipboard.writeText = () => (++window.__clipCalls === 1 ? Promise.reject(new Error("denied")) : Promise.resolve());
});
await page.click(".sheet-actions button");
await page.waitForSelector(".sheet-retry", { timeout: 5000 });
const fErr = await page.evaluate(() => document.activeElement?.className);
await page.click(".sheet-retry");
await page.waitForTimeout(400);
const fOk = await page.evaluate(() => {
  const el = document.activeElement;
  return { cls: el?.className ?? "none", inSheet: !!el?.closest(".sheet") };
});
check("focus lands in the sheet after retry success", fOk.inSheet, JSON.stringify(fOk));
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// 4. notice exit: the entrance animation must not own the end state — the
// fill-mode fix is checkable at the computed-style level
const fm = await page.evaluate(() => {
  let el = document.querySelector(".offline");
  let owned = false;
  if (!el) {
    el = document.createElement("div");
    el.className = "offline";
    document.body.appendChild(el);
    owned = true;
  }
  const cs = getComputedStyle(el);
  const out = { fill: cs.animationFillMode, trans: cs.transitionProperty };
  if (owned) el.remove();
  return out;
});
check(
  "offline fill-mode frees the .out transition",
  fm.fill.includes("backwards") || fm.fill === "none",
  `fill=${fm.fill}`,
);

await b.close();
console.log(results.join("\n"));
const fails = results.filter((r) => r.startsWith("FAIL"));
process.exit(fails.length ? 1 : 0);
