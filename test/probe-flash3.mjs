import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
page.on("console", m => { if (m.text().startsWith("YFLASH")) console.log(m.text()); });
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(1500);
await page.evaluate(() => {
  window.__fl = [];
  new MutationObserver(() => {
    const f = document.querySelector(".toolflash");
    window.__fl.push({ t: performance.now() | 0, on: !!f, left: f?.style.left });
  }).observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll(".tbtn").forEach(el => el.addEventListener("click", () =>
    console.log("YFLASH clicked", el.dataset.tool, el.getBoundingClientRect().left)));
});
await page.click('[data-tool="rain"]');
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(250);
  const s = await page.evaluate(() => ({
    on: !!document.querySelector(".toolflash"),
    left: document.querySelector(".toolflash")?.style.left,
    fl: window.__fl.slice(-3),
  }));
  console.log(i * 250 + "ms", JSON.stringify(s));
}
await b.close();
