// r18: the keyframe was already right at r17 — the painted frame was not.
// Removing .out rebirthed the CSS entrance under the handoff clip, so a
// reopen mid-exit painted 0 on the next frames. Now reenter pins
// animation:none on the node, and the painted opacities after the reopen
// must start at the live value and rise — never dip to ~0.
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4461/";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(url);
await page.waitForFunction(() => window.__yesca?.stats, null, { timeout: 45000 });
await page.waitForSelector(".guide", { state: "visible", timeout: 40000 });
await page.waitForTimeout(1600);

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, detail ?? "");
};

// close -> wait for .out + exit clip -> seek 45% -> read live -> reopen in
// the same task -> sample painted opacity for 10 rAF frames. With the pin,
// frame 0 is the seeked value and the series climbs to 1. Unpinned, frame 0
// is ~0 under the reborn CSS entrance.
const paintedProbe = (sel, openExpr, closeExpr, reopenExpr, outSel) => `
(async () => {
  const q = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waapi = (el) => el.getAnimations().filter((a) => a.constructor.name === "Animation");
  if (!q(${JSON.stringify(sel)})) { ${openExpr} }
  const t0 = performance.now();
  let el = null;
  while (performance.now() - t0 < 4000) {
    el = q(${JSON.stringify(sel)});
    if (el && parseFloat(getComputedStyle(el).opacity) > 0.98) break;
    await sleep(40);
  }
  if (!el) return { err: "never visible" };
  ${closeExpr}
  // poll for the .out commit — a fixed sleep can be throttled past the
  // linger window in headless and lose the node entirely
  let exitEl = null;
  {
    const t1 = performance.now();
    while (performance.now() - t1 < 220) {
      exitEl = q(${JSON.stringify(sel)});
      if (exitEl && q(${JSON.stringify(outSel ?? sel)})?.classList.contains("out") && waapi(exitEl).length) break;
      await sleep(6);
    }
  }
  if (!exitEl) return { err: "unmounted before .out" };
  if (!q(${JSON.stringify(outSel ?? sel)})?.classList.contains("out")) return { err: ".out never committed" };
  const exits = waapi(exitEl);
  if (!exits.length) return { err: "no exit clip" };
  const exitAnim = exits[exits.length - 1];
  const dur = exitAnim.effect.getComputedTiming().duration;
  exitAnim.currentTime = dur * 0.45;
  const cs = getComputedStyle(exitEl);
  const live = { o: parseFloat(cs.opacity), t: cs.transform };
  if (!(live.o > 0.05 && live.o < 0.98)) return { err: "seek gave vacuous sample", live, dur };
  ${reopenExpr}
  const enters = waapi(exitEl);
  const enter = enters[enters.length - 1];
  const kf = enter ? enter.effect.getKeyframes() : [];
  const frames = [];
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => requestAnimationFrame(r));
    frames.push(parseFloat(getComputedStyle(exitEl).opacity));
  }
  return {
    live,
    clipFrom: kf[0] ? kf[0].opacity : null,
    clipTo: kf[kf.length - 1] ? kf[kf.length - 1].opacity : null,
    animName: getComputedStyle(exitEl).animationName,
    frames: frames.map((f) => +f.toFixed(4)),
  };
})()`;

// the painted series must start at the live value (or the clip's own first
// step), never touch ~0, and end at 1
const ridesPainted = (r) =>
  !r.err &&
  r.clipTo === "1" &&
  Math.abs(parseFloat(r.clipFrom) - r.live.o) < 1e-3 &&
  r.animName === "none" &&
  r.frames[0] > 0.01 &&
  r.frames[0] >= r.live.o - 0.02 &&
  r.frames[r.frames.length - 1] > 0.9 &&
  Math.min(...r.frames) > 0.01;

// ============ 1. place tray ============
const tray = await page.evaluate(
  paintedProbe(
    ".placetray",
    "q('.place-btn').click();",
    "q('.place-btn').click();",
    "q('.place-btn').click();",
  ),
);
check("tray reopen paints the live value, not 0", ridesPainted(tray), JSON.stringify(tray));
await page.evaluate(() => document.querySelector(".placetray") && document.querySelector(".place-btn").click());
await page.waitForTimeout(400);

// ============ 2. share sheet + scrim ============
await page.evaluate(() => document.querySelector(".g-skip")?.click());
await page.waitForTimeout(800);
await page.evaluate(async () => {
  const y = window.__yesca;
  const seed = () => {
    for (let i = -5; i <= 5; i++)
      for (let j = -5; j <= 5; j++) y.ignite(0.5 + i * 0.012, 0.5 + j * 0.012);
  };
  seed();
  for (let i = 0; i < 30 && !document.querySelector(".sharechip"); i++) {
    await new Promise((r) => setTimeout(r, 3000));
    seed();
  }
});
if (!(await page.evaluate(() => !!document.querySelector(".sharechip")))) {
  check("sheet reopen paints the live value", false, "chip never mounted");
  check("scrim reopen paints the live value", false, "chip never mounted");
} else {
  const sheet = await page.evaluate(
    paintedProbe(
      ".sheet",
      "q('.sharechip').click();",
      "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));",
      "q('.sharechip').click();",
      ".sheet-back",
    ),
  );
  check("sheet reopen paints the live value", ridesPainted(sheet), JSON.stringify(sheet));
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await page.waitForTimeout(400);
  const scrim = await page.evaluate(
    paintedProbe(
      ".sheet-back",
      "q('.sharechip').click();",
      "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));",
      "q('.sharechip').click();",
    ),
  );
  check("scrim reopen paints the live value", ridesPainted(scrim), JSON.stringify(scrim));
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await page.waitForTimeout(400);
}

// ============ 3. guide replay mid-exit ============
await page.keyboard.press("?");
await page.waitForSelector(".guide:not(.out)", { timeout: 8000 });
await page.waitForTimeout(300);
const guide = await page.evaluate(
  paintedProbe(
    ".guide",
    "",
    "document.querySelector('.g-skip').click();",
    "window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));",
  ),
);
check("guide replay paints the live value", ridesPainted(guide), JSON.stringify(guide));

// ============ 4. fresh mount still gets the CSS entrance ============
// the pin lives on the node; a remount must carry no inline style, or first
// opens would lose their authored entrances forever
const fresh = await page.evaluate(async () => {
  // the offline banner unmounts after its linger — force the cycle
  window.dispatchEvent(new Event("offline"));
  await new Promise((r) => setTimeout(r, 80));
  const el = document.querySelector(".conn");
  return { mounted: !!el, inlineAnim: el?.style.animation ?? null };
});
check("fresh mount carries no animation pin", fresh.mounted && !fresh.inlineAnim, JSON.stringify(fresh));
await page.evaluate(() => window.dispatchEvent(new Event("online")));

console.log("errors:", JSON.stringify(errors));
const ok = results.every((r) => r.ok) && errors.length === 0;
console.log(ok ? "R18 PASS" : "R18 FAIL");
await b.close();
process.exit(ok ? 0 : 1);
