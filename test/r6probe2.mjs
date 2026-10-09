import { chromium } from "playwright";

const URL = "http://localhost:4421/";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 640 }, deviceScaleFactor: 1 });
await page.goto(URL);
await page.waitForFunction(() => !!window.__yesca, null, { timeout: 60000 });
await page.evaluate(() => localStorage.setItem("yesca.guide.v1", "1"));
await page.reload();
await page.waitForFunction(() => !!window.__yesca, null, { timeout: 60000 });
await page.waitForTimeout(3500);

// --- TextMorph duplicate text / aria ---
const morph = await page.evaluate(() => {
  const el = document.querySelector(".place-btn");
  return { html: el?.innerHTML?.slice(0, 600), text: el?.textContent };
});
console.log("place-btn textMorph:", JSON.stringify(morph, null, 1));

// --- toolflash anchoring per button ---
for (const t of ["orbit", "match", "break", "rain"]) {
  await page.click(`[data-tool="${t}"]`);
  await page.waitForTimeout(140);
  const r = await page.evaluate(() => {
    const f = document.querySelector(".toolflash");
    const b = document.querySelector(".tbtn.on");
    if (!f || !b) return null;
    const fr = f.getBoundingClientRect(), br = b.getBoundingClientRect();
    return {
      word: f.textContent,
      flashCenter: Math.round(fr.left + fr.width / 2),
      btnCenter: Math.round(br.left + br.width / 2),
      flashBox: [Math.round(fr.left), Math.round(fr.right)],
      inViewport: fr.left >= 0 && fr.right <= innerWidth,
      flashBottom: Math.round(innerHeight - fr.bottom),
    };
  });
  console.log(t, JSON.stringify(r));
}

// --- keyboard switch: haptics + anchoring ---
const hapticCalls = await page.evaluate(() => {
  window.__hap = 0;
  const orig = navigator.vibrate?.bind(navigator);
  navigator.vibrate = (...a) => { window.__hap++; return orig ? orig(...a) : true; };
  return true;
});
await page.keyboard.press("4");
await page.waitForTimeout(150);
console.log("keyboard '4' flash:", JSON.stringify(await page.evaluate(() => {
  const f = document.querySelector(".toolflash");
  const b = document.querySelector('[data-tool="rain"]');
  if (!f) return "no flash";
  const fr = f.getBoundingClientRect(), br = b.getBoundingClientRect();
  return { flashCenter: Math.round(fr.left + fr.width / 2), btnCenter: Math.round(br.left + br.width / 2) };
})));

// --- Enter-paint path flash position (claimed anchored, code says center) ---
await page.click(`[data-tool="match"]`);
await page.waitForTimeout(1500);
await page.evaluate(() => document.querySelector("canvas.stage").focus());
await page.keyboard.press("Enter");
await page.waitForTimeout(150);
console.log("Enter-paint flash:", JSON.stringify(await page.evaluate(() => {
  const f = document.querySelector(".toolflash");
  const b = document.querySelector('[data-tool="orbit"]');
  if (!f) return "no flash";
  const fr = f.getBoundingClientRect(), br = b.getBoundingClientRect();
  return { word: f.textContent, flashCenter: Math.round(fr.left + fr.width / 2), orbitBtnCenter: Math.round(br.left + br.width / 2) };
})));

// --- grow a burn, then open the share sheet and measure layout ---
await page.evaluate(() => {
  for (let i = 0; i < 5; i++) window.__yesca.ignite(0.48 + i * 0.01, 0.5 + i * 0.008);
});
await page.waitForTimeout(16000);
console.log("stats:", JSON.stringify(await page.evaluate(() => window.__yesca.stats())));

const chip = await page.$(".sharechip");
console.log("sharechip present:", !!chip);
if (chip) {
  const chipBox = await page.evaluate(() => {
    const r = document.querySelector(".sharechip").getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top) };
  });
  await chip.click();
  await page.waitForTimeout(1200);
  const sheet = await page.evaluate(() => {
    const b = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { sel, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), r: Math.round(r.right) };
    };
    return { boxes: [".sheet", ".sheet canvas", ".sheet-row", ".sheet-cap", ".sheet-actions"].map(b).filter(Boolean), vw: innerWidth };
  });
  console.log("chip origin:", JSON.stringify(chipBox));
  console.log("share sheet:", JSON.stringify(sheet, null, 1));
  await page.screenshot({ path: "/tmp/r6-share.png" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
}
await page.screenshot({ path: "/tmp/r6-burn.png" });

// --- place tray: scroll clipping + truncation ---
await page.click(".place-btn");
await page.waitForTimeout(600);
const tray = await page.evaluate(() => {
  const list = document.querySelector(".pt-list");
  const names = [...document.querySelectorAll(".pt-name")].map((n) => ({
    t: n.textContent, trunc: n.scrollWidth > n.clientWidth + 1,
  }));
  const lr = list.getBoundingClientRect();
  return {
    scrollH: list.scrollHeight, clientH: list.clientHeight,
    scrollable: list.scrollHeight > list.clientHeight,
    maskImage: getComputedStyle(list).maskImage,
    names: names.slice(0, 14),
  };
});
console.log("place tray:", JSON.stringify(tray, null, 1));
await page.screenshot({ path: "/tmp/r6-tray.png" });

await browser.close();
