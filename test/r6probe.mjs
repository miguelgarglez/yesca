import { chromium } from "playwright";

const URL = "http://localhost:4421/";

const run = async (label, viewport) => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  const errs = [];
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.goto(URL);
  await page.waitForFunction(() => !!window.__yesca, null, { timeout: 60000 });

  const t0 = Date.now();
  const samples = [];
  for (let i = 0; i < 24; i++) {
    const s = await page.evaluate(() => {
      const g = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          op: +getComputedStyle(el).opacity,
          vis: getComputedStyle(el).visibility,
          top: Math.round(r.top), bottom: Math.round(r.bottom),
          left: Math.round(r.left), right: Math.round(r.right),
        };
      };
      return {
        revealed: document.body.classList.contains("revealed"),
        instruments: g(".instruments"),
        rail: g(".rail"),
        masthead: g(".masthead"),
        tray: g(".tray"),
        guide: g(".guide"),
        gline: g(".g-line"),
      };
    });
    samples.push({ t: Date.now() - t0, ...s });
    await page.waitForTimeout(150);
  }

  console.log(`\n===== ${label} (${viewport.width}x${viewport.height}) =====`);
  console.log("t(ms) revealed inst.op rail.op  inst-box            guide-box");
  for (const s of samples) {
    console.log(
      String(s.t).padStart(5),
      String(s.revealed).padStart(8),
      String(s.instruments?.op ?? "-").padStart(7),
      String(s.rail?.op ?? "-").padStart(7),
      ` ${s.instruments ? `${s.instruments.left},${s.instruments.top}-${s.instruments.right},${s.instruments.bottom}` : "-"}`.padEnd(22),
      s.guide ? `${s.guide.left},${s.guide.top}-${s.guide.right},${s.guide.bottom}` : "-",
    );
  }

  // peak opacity of instruments/rail while the guide is on screen
  const guided = samples.filter((s) => s.guide);
  const peakInst = Math.max(...guided.map((s) => s.instruments?.op ?? 0));
  const peakRail = Math.max(...guided.map((s) => s.rail?.op ?? 0));
  console.log(`\nwhile guide visible: peak .instruments opacity=${peakInst}  peak .rail opacity=${peakRail}`);

  // final geometry: collision check guide vs instruments/rail/tray
  const geo = await page.evaluate(() => {
    const b = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { sel, op: +cs.opacity, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom) };
    };
    return [".guide", ".g-line", ".g-skip", ".instruments", ".rail", ".tray", ".masthead"].map(b).filter(Boolean);
  });
  console.log("\nfinal boxes:");
  for (const g of geo) console.log("  ", JSON.stringify(g));

  // overflow check on the guide line
  const over = await page.evaluate(() => {
    const el = document.querySelector(".g-line");
    if (!el) return null;
    return { scrollW: el.scrollWidth, clientW: el.clientWidth, text: el.textContent };
  });
  console.log("  g-line overflow:", JSON.stringify(over));

  if (errs.length) console.log("\nconsole errors:", errs.slice(0, 5));
  await browser.close();
};

await run("desktop", { width: 1024, height: 640 });
await run("mobile", { width: 375, height: 720 });
