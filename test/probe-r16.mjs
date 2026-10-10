// r16/r17: reopening inside an exit window must ride the live value back.
// the discriminant is airtight: the exit clip is seeked to 45% (synchronous —
// currentTime assignment lands on the next style recalc, which
// getComputedStyle forces), the live value is read, and the reopen fires in
// the SAME task. nothing renders between the two reads, so the enter clip's
// first keyframe must equal that sampled value exactly — not 0, not the
// .out end pose. (a live CSSStyleDeclaration read after cancel() records the
// end pose — that was the r16 bug this probe exists to catch.)
import { chromium } from "playwright";

const url = process.argv[2] ?? "http://localhost:4421/";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(url);
await page.waitForFunction(() => window.__yesca?.stats, null, { timeout: 45000 });
await page.waitForSelector(".guide", { state: "visible", timeout: 40000 });
await page.waitForTimeout(1600); // past the entrance

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`, detail ?? "");
};

// settle → close → wait .out + exit clip → seek clip to 45% → read live →
// reopen synchronously → enter clip's keyframe[0] === live, keyframe[-1] === rest
const reopenProbe = (sel, openExpr, closeExpr, reopenExpr, outSel) => `
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
    await sleep(20);
  }
  if (!el) return { err: "no element after open" };
  ${closeExpr}
  const t1 = performance.now();
  while (performance.now() - t1 < 600) {
    if (q(${JSON.stringify(outSel ?? sel)})?.classList.contains("out")) break;
    await sleep(8);
  }
  const exitEl = q(${JSON.stringify(sel)});
  if (!exitEl) return { err: "unmounted before .out" };
  if (!q(${JSON.stringify(outSel ?? sel)})?.classList.contains("out")) return { err: ".out never committed" };
  const exits = waapi(exitEl);
  if (!exits.length) return { err: "no exit clip" };
  const exitAnim = exits[exits.length - 1];
  const dur = exitAnim.effect.getComputedTiming().duration;
  exitAnim.currentTime = dur * 0.45;          // deterministic mid-exit
  const cs = getComputedStyle(exitEl);        // forces recalc at the seeked time
  const live = { o: parseFloat(cs.opacity), t: cs.transform };
  if (!(live.o > 0.05 && live.o < 0.98)) return { err: "seek gave vacuous sample", live, dur };
  ${reopenExpr}
  const enters = waapi(exitEl);
  const enter = enters[enters.length - 1];
  const kf = enter ? enter.effect.getKeyframes() : [];
  return {
    live,
    clipFrom: kf[0] ? { o: kf[0].opacity, t: kf[0].transform } : null,
    clipTo: kf[kf.length - 1] ? { o: kf[kf.length - 1].opacity, t: kf[kf.length - 1].transform } : null,
  };
})()`;

// same task → the captured keyframe must equal the sampled live value exactly,
// and it must be a real mid-exit number — "0" is the .out end pose, i.e. the bug
const ridesLive = (r) =>
  !r.err &&
  r.clipFrom &&
  r.clipTo?.o === "1" &&
  Math.abs(parseFloat(r.clipFrom.o) - r.live.o) < 1e-3 &&
  r.clipFrom.t === r.live.t;

// ============ 1. place tray ============
const tray = await page.evaluate(
  reopenProbe(
    ".placetray",
    "q('.place-btn').click();",
    "q('.place-btn').click();",
    "q('.place-btn').click();",
  ),
);
check("tray reopen rides live value", ridesLive(tray), JSON.stringify(tray));
await page.evaluate(() => document.querySelector(".placetray") && document.querySelector(".place-btn").click());
await page.waitForTimeout(400);

// ============ 2. share sheet ============
// the chip only mounts once the tour is done — finish it first
await page.evaluate(() => document.querySelector(".g-skip")?.click());
await page.waitForTimeout(800);
await page.evaluate(async () => {
  const y = window.__yesca;
  // a dense block of strikes — Gredos fuel is patchy, so seed broadly
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
  check("sheet reopen rides live value", false, "chip never mounted");
} else {
  const sheet = await page.evaluate(
    reopenProbe(
      ".sheet",
      "q('.sharechip').click();",
      "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));",
      "q('.sharechip').click();",
      ".sheet-back",
    ),
  );
  check("sheet reopen rides live value", ridesLive(sheet), JSON.stringify(sheet));
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  await page.waitForTimeout(400);
}

// ============ 3. guide replay mid-exit ============
await page.keyboard.press("?"); // ensure it's running (idempotent at orbit)
await page.waitForSelector(".guide:not(.out)", { timeout: 8000 });
await page.waitForTimeout(300);
const guideRe = await page.evaluate(
  reopenProbe(
    ".guide",
    "",
    "document.querySelector('.g-skip').click();",
    "window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));",
  ),
);
// the reopen polls .replay landing too — re-read class + delay
const guideMeta = await page.evaluate(async () => {
  const el = document.querySelector(".guide");
  const t0 = performance.now();
  while (performance.now() - t0 < 600) {
    if (el?.classList.contains("replay")) break;
    await new Promise((r) => setTimeout(r, 15));
  }
  return { cls: el?.className, delay: el ? getComputedStyle(el).animationDelay : null };
});
check("guide replay mid-exit rides live value", ridesLive(guideRe), JSON.stringify(guideRe));
check(
  "guide replay drops the first-appearance delay",
  guideMeta.cls?.includes("replay") && guideMeta.delay === "0s",
  `delay=${guideMeta.delay} cls=${guideMeta.cls}`,
);

// ============ 4. toast leave retraces its entrance (+8px, not -4px) ============
const connEnd = await page.evaluate(() => {
  for (const s of document.styleSheets) {
    try {
      const rule = [...s.cssRules].find((r) => r.selectorText === ".offline.out");
      if (rule) return rule.style.transform;
    } catch {}
  }
  return null;
});
check("toast leave retraces its entrance (+8px)", connEnd?.includes("translateY(8px)"), connEnd ?? "rule missing");

// ============ 5. conn banner re-drop mid-exit ============
const connRe = await page.evaluate(
  reopenProbe(
    ".conn",
    "window.dispatchEvent(new Event('offline'));",
    "window.dispatchEvent(new Event('online'));",
    "window.dispatchEvent(new Event('offline'));",
  ),
);
check("conn reenter rides live value", ridesLive(connRe), JSON.stringify(connRe));
await page.evaluate(() => window.dispatchEvent(new Event("online")));

console.log("errors:", JSON.stringify(errors));
const fails = results.filter((r) => !r.ok);
console.log(fails.length ? `R16 FAIL (${fails.length})` : "R16 PASS");
await b.close();
process.exit(fails.length ? 1 : 0);
