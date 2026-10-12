import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.goto("http://localhost:4461/?debug");
await p.waitForFunction(() => window.__yesca, { timeout: 45000 });
await p.waitForTimeout(6000);
const m = await p.evaluate(async () => {
  const y = window.__yesca;
  for (let u = 0.38; u <= 0.62; u += 0.04)
    for (let v = 0.42; v <= 0.66; v += 0.04) y.ignite(u, v);
  for (let i = 0; i < 450; i++) y.sim.update(0.1); // 45 sim-s — fully cooled center
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const c = document.querySelector("canvas");
  const g = c.getContext("webgl2");
  const w = c.width, h = c.height;
  const px = new Uint8Array(w * h * 4);
  g.readPixels(0, 0, w, h, g.RGBA, g.UNSIGNED_BYTE, px);
  let n = 0, sr = 0, sg = 0, sb = 0; const lums = [];
  for (let yy = Math.floor(h*0.3); yy < h*0.7; yy += 3)
    for (let xx = Math.floor(w*0.35); xx < w*0.65; xx += 3) {
      const i = (yy*w+xx)*4; sr += px[i]; sg += px[i+1]; sb += px[i+2]; n++;
      lums.push(0.2126*px[i] + 0.7152*px[i+1] + 0.0722*px[i+2]);
    }
  lums.sort((a,b)=>a-b);
  return {mean:[Math.round(sr/n),Math.round(sg/n),Math.round(sb/n)],p10:lums[Math.floor(lums.length*0.1)].toFixed(1),med:lums[Math.floor(lums.length*0.5)].toFixed(1),st:y.stats()};
});
console.log(JSON.stringify(m));
await p.screenshot({ path: process.argv[2] });
await b.close();
