import { chromium } from "playwright";
const base = process.argv[2] || "http://localhost:3001";
const caseId = process.argv[3];
const out = process.argv[4] || "/tmp/cp2";
const clickDoc = process.argv[5]; // optional doc chip text to click

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto(`${base}/case/${caseId}`, { waitUntil: "networkidle" });
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}-case.png` });
if (clickDoc) {
  await page.click(`text=${clickDoc}`, { timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}-drawer.png` });
}
await browser.close();
console.log("done");
