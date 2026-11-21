// Screenshot helper: node scripts/shots.mjs [baseUrl] [outdir]
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:3001";
const out = process.argv[3] || "/tmp/shots";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}-queue.png`, fullPage: false });

// open the first case (case ids look like BK-CS12345)
const firstCase = await page.evaluate(() => {
  const el = document.querySelector("[data-idx='0']");
  const m = el?.textContent?.match(/[A-Z]{2}-CS\d+/);
  return m?.[0];
});
if (firstCase) {
  await page.goto(`${base}/case/${firstCase}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500); // let decision path reveal + graph settle
  await page.screenshot({ path: `${out}-case.png`, fullPage: false });
}
await browser.close();
console.log("shots →", out);
