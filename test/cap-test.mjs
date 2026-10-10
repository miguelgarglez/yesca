import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(() => localStorage.setItem("yesca.guide.v1", "1"));
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(2500);
const r = await page.evaluate(() => {
  try {
    const s = window.__yesca.stage;
    s.renderer.render(s.scene, s.camera);
    const src = s.renderer.domElement;
    const c = document.createElement("canvas");
    c.width = 1280; c.height = 720;
    const ctx = c.getContext("2d");
    ctx.drawImage(src, 0, 0);
    return { ok: true, len: c.toDataURL("image/png").length };
  } catch (e) { return { ok: false, err: String(e) }; }
});
console.log(JSON.stringify(r));
await b.close();
