import { chromium } from "playwright";
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", e => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:4421");
await page.waitForFunction(() => window.__yesca, { timeout: 45000 });
await page.waitForTimeout(3500);

// 1. lesson tool lock: press "3" during step 1 → stays orbit, flash at orbit btn
await page.keyboard.press("3");
await page.waitForTimeout(300);
const lock = await page.evaluate(() => ({
  lit: document.querySelector(".tbtn.on")?.dataset.tool,
  flash: document.querySelector(".toolflash")?.textContent,
  flashLeft: document.querySelector(".toolflash")?.style.left,
  orbitCx: document.querySelector('.tbtn[data-tool="orbit"]')?.getBoundingClientRect().left,
}));
console.log("lesson lock:", JSON.stringify(lock));

// 2. g-buzz present + toggles
const buzz = await page.evaluate(() => document.querySelector(".g-buzz")?.textContent);
await page.click(".g-buzz");
await page.waitForTimeout(200);
const buzz2 = await page.evaluate(() => ({
  txt: document.querySelector(".g-buzz")?.textContent,
  persisted: localStorage.getItem("yesca.buzz"),
}));
console.log("buzz:", buzz, "→", JSON.stringify(buzz2));
await page.click(".g-buzz"); // restore

// 3. tab → kb hint appears
await page.keyboard.press("Tab");
await page.waitForTimeout(200);
const kb = await page.evaluate(() => getComputedStyle(document.querySelector(".g-keys")).display);
console.log("g-keys display after Tab:", kb);

// 4. complete tour by pointer quickly: orbit drags + strike + break
await page.evaluate(() => document.activeElement?.blur()); // drop focus back to the field
for (let i = 0; i < 12; i++) { await page.keyboard.press("Enter"); await page.waitForTimeout(120); }
await page.waitForFunction(() => document.querySelector(".g-line")?.textContent.includes("match"), { timeout: 8000 });
await page.keyboard.press("2"); await page.keyboard.press(" "); await page.waitForTimeout(1000);
await page.keyboard.press("3"); await page.keyboard.press(" "); await page.waitForTimeout(1200);

// 5. burn enough for the chip, then exercise share focus lifecycle
console.log("guide after tour:", await page.evaluate(() => document.querySelector(".g-line")?.textContent?.slice(0, 30) ?? "gone"));
await page.evaluate(() => { for (const [u,v] of [[0.48,0.46],[0.5,0.48],[0.52,0.5],[0.5,0.44],[0.46,0.52],[0.54,0.46]]) window.__yesca.ignite(u,v); });
for (let w = 0; w < 24; w++) {
  const st = await page.evaluate(() => ({ b: window.__yesca.stats().burnt, chip: !!document.querySelector(".sharechip") }));
  if (st.chip) break;
  if (w % 6 === 5) console.log("  waiting: burnt", st.b.toFixed(5));
  await page.waitForTimeout(5000);
}
await page.waitForSelector(".sharechip", { timeout: 5000 });
await page.click(".sharechip");
await page.waitForSelector(".sheet", { timeout: 8000 });
await page.waitForTimeout(600);
const focus = await page.evaluate(() => document.activeElement?.textContent?.slice(0, 20));
console.log("focused on open:", focus);
// force clipboard failure → err state + retry
await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error("denied")); });
await page.click(".sheet-actions button");
await page.waitForTimeout(400);
const errState = await page.evaluate(() => ({
  url: !!document.querySelector(".sheet-url"),
  retry: document.querySelector(".sheet-retry")?.textContent,
}));
console.log("clipboard err:", JSON.stringify(errState));
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
const close = await page.evaluate(() => ({
  sheetGone: !document.querySelector(".sheet-back:not(.out)"),
  focus: document.activeElement?.className,
}));
console.log("after esc:", JSON.stringify(close));
await page.waitForTimeout(400);
const unmounted = await page.evaluate(() => !document.querySelector(".sheet-back"));
console.log("sheet unmounted after fade:", unmounted);

// 6. tray exit + empty search
await page.click(".place-btn");
await page.waitForSelector(".placetray", { timeout: 5000 });
await page.fill(".pt-head input", "zzzxq hill");
await page.waitForTimeout(1200);
const empty = await page.evaluate(() => document.querySelector(".pt-note")?.textContent);
console.log("empty search note:", empty);
await page.keyboard.press("Escape");
await page.waitForTimeout(100);
const trayOut = await page.evaluate(() => document.querySelector(".placetray")?.className);
console.log("tray during exit:", trayOut);
await page.waitForTimeout(400);
console.log("tray gone:", await page.evaluate(() => !document.querySelector(".placetray")));
await b.close();
