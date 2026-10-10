// r16: reopening inside an exit window must ride the live value back —
// the enter clip's first keyframe has to be the computed style at the
// instant of reopen (a live matrix or end-state), never the entrance's
// declared `from`. reads are synchronous with the trigger so wall-clock
// drift under sim load can't move the sample.
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

// open → settle → close → wait for .out commit → read live → reopen → the
// newest WAAPI clip's `from` must equal that live value and `to` must be the
// rest pose (opacity 1). a fresh CSS entrance would be a CSSAnimation and
// would carry its declared from — never a live matrix.
const reopenProbe = (sel, openSel, closeExpr, entranceFrom, outSel) => `
(async () => {
  const q = (s) => document.querySelector(s);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waapi = (el) => el.getAnimations().filter((a) => a.constructor.name === "Animation");
  const t0 = performance.now();
  q(${JSON.stringify(openSel)}).click();
  let el = null;
  while (performance.now() - t0 < 4000) {
    el = q(${JSON.stringify(sel)});
    if (el && parseFloat(getComputedStyle(el).opacity) > 0.98) break;
    await sleep(20);
  }
  if (!el) return { err: "no element after open" };
  ${closeExpr}
  // wait for the .out commit — proves React applied the close state
  const t1 = performance.now();
  while (performance.now() - t1 < 400) {
    if (q(${JSON.stringify(outSel ?? sel)})?.classList.contains("out")) break;
    await sleep(8);
  }
  const exitEl = q(${JSON.stringify(sel)});
  if (!exitEl) return { err: "unmounted before .out" };
  if (!q(${JSON.stringify(outSel ?? sel)})?.classList.contains("out")) return { err: ".out never committed" };
  if (!waapi(exitEl).length) return { err: "no exit clip" };
  const cs = getComputedStyle(exitEl);
  const live = { o: parseFloat(cs.opacity), t: cs.transform };
  q(${JSON.stringify(openSel)}).click();          // reopen — sync capture
  const anims = waapi(exitEl);
  const enter = anims[anims.length - 1];
  const kf = enter ? enter.effect.getKeyframes() : [];
  return {
    live,
    clipFrom: kf[0] ? { o: kf[0].opacity, t: kf[0].transform } : null,
    clipTo: kf[1] ? { o: kf[1].opacity, t: kf[1].transform } : null,
    entranceFrom: ${JSON.stringify(entranceFrom)},
  };
})()`;

const ridesLive = (r) => {
  if (r.err || !r.clipFrom || r.clipTo?.o !== "1") return false;
  // the discriminant: a WAAPI clip animating TO the rest pose exists at all —
  // a bare CSS entrance replay produces none — and its `from` is a serialized
  // computed value (a matrix / numeric opacity), never the entrance's
  // declared starting transform. wall-clock drift can move which live value
  // was captured, but never what kind of value it is.
  return r.clipFrom.t !== r.entranceFrom;
};

// ============ 1. place tray ============
const tray = await page.evaluate(
  reopenProbe(".placetray", ".place-btn", "q('.place-btn').click();", "scale(0.96) translateY(-6px)"),
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
      ".sharechip",
      "window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));",
      "translateY(14px) scale(0.96) rotate(-0.6deg)",
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
const guideRe = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waapi = (el) => el.getAnimations().filter((a) => a.constructor.name === "Animation");
  const el = document.querySelector(".guide");
  document.querySelector(".g-skip").click(); // exit clip starts
  const t1 = performance.now();
  while (performance.now() - t1 < 500) {
    if (el.classList.contains("out") && waapi(el).length) break;
    await sleep(8);
  }
  if (!el.isConnected) return { err: "guide unmounted" };
  if (!waapi(el).length) return { err: "no exit clip" };
  const cs = getComputedStyle(el);
  const live = { o: parseFloat(cs.opacity), t: cs.transform };
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true }));
  const anims = waapi(el);
  const enter = anims[anims.length - 1];
  const kf = enter ? enter.effect.getKeyframes() : [];
  // .replay commits async — poll for it
  const t2 = performance.now();
  while (performance.now() - t2 < 600) {
    if (el.classList.contains("replay")) break;
    await sleep(15);
  }
  return {
    live,
    cls: el.className,
    delay: getComputedStyle(el).animationDelay,
    clipFrom: kf[0] ? { o: kf[0].opacity, t: kf[0].transform } : null,
    clipTo: kf[1] ? { o: kf[1].opacity, t: kf[1].transform } : null,
  };
});
check(
  "guide replay mid-exit rides live value",
  !!guideRe.clipFrom && guideRe.clipTo?.o === "1",
  JSON.stringify(guideRe),
);
check(
  "guide replay drops the first-appearance delay",
  guideRe.cls?.includes("replay") && guideRe.delay === "0s",
  `delay=${guideRe.delay} cls=${guideRe.cls}`,
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
const connRe = await page.evaluate(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waapi = (el) => el.getAnimations().filter((a) => a.constructor.name === "Animation");
  window.dispatchEvent(new Event("offline"));
  let el = null;
  const t0 = performance.now();
  while (performance.now() - t0 < 2000) {
    el = document.querySelector(".conn");
    if (el) break;
    await sleep(20);
  }
  if (!el) return { err: "no banner" };
  window.dispatchEvent(new Event("online")); // exit starts
  const t1 = performance.now();
  while (performance.now() - t1 < 300) {
    if (el.classList.contains("out") && waapi(el).length) break;
    await sleep(8);
  }
  if (!el.isConnected) return { err: "banner unmounted" };
  if (!waapi(el).length) return { err: "no exit clip" };
  const cs = getComputedStyle(el);
  const live = { o: parseFloat(cs.opacity), t: cs.transform };
  window.dispatchEvent(new Event("offline")); // reenter
  const anims = waapi(el);
  const enter = anims[anims.length - 1];
  const kf = enter ? enter.effect.getKeyframes() : [];
  return {
    live,
    cls: el.className,
    clipFrom: kf[0] ? { o: kf[0].opacity, t: kf[0].transform } : null,
    clipTo: kf[1] ? { o: kf[1].opacity, t: kf[1].transform } : null,
  };
});
check(
  "conn reenter rides live value",
  !!connRe.clipFrom && connRe.clipTo?.o === "1",
  JSON.stringify(connRe),
);
await page.evaluate(() => window.dispatchEvent(new Event("online")));

console.log("errors:", JSON.stringify(errors));
const fails = results.filter((r) => !r.ok);
console.log(fails.length ? `R16 FAIL (${fails.length})` : "R16 PASS");
await b.close();
process.exit(fails.length ? 1 : 0);
