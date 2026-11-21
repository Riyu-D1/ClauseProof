// No-loop proof for /live (bug: "it keeps reloading and running").
//
//   1. load /live and idle 20s           → 0 calls to /api/live
//   2. click an example chip             → exactly 1 call
//   3. idle again                        → still 1 (no auto re-run)
//   4. click RUN THE ENGINE once more    → exactly 2 total
//
// Run from web/ with the app up:  node scripts/no-loop.mjs [base]
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:3210";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });

const hits = [];
page.on("request", (r) => {
  if (new URL(r.url()).pathname === "/api/live") {
    hits.push({ method: r.method(), t: new Date().toISOString().slice(11, 19) });
  }
});

await page.goto(`${base}/live`, { waitUntil: "networkidle" });
console.log("idle watch: 20s …");
await page.waitForTimeout(20_000);
const idle = hits.length;

const click1 = page.waitForResponse(
  (r) => new URL(r.url()).pathname === "/api/live" && r.status() === 200,
  { timeout: 90_000 }
);
await page.getByRole("button", { name: /money mule/i }).click();
await click1;
await page.waitForTimeout(8_000); // would reveal any auto re-run
const afterChip = hits.length;

const click2 = page.waitForResponse(
  (r) => new URL(r.url()).pathname === "/api/live" && r.status() === 200,
  { timeout: 90_000 }
);
await page.getByRole("button", { name: /run the engine/i }).click();
await click2;
await page.waitForTimeout(8_000);
const afterRun = hits.length;

await browser.close();

console.log("hits:", JSON.stringify(hits));
console.log(`idle 20s: ${idle} | after chip click +8s: ${afterChip} | after Run click +8s: ${afterRun}`);
const pass = idle === 0 && afterChip === 1 && afterRun === 2;
console.log(pass ? "PASS — runs only happen on explicit clicks, exactly once each"
               : "FAIL — unexpected /api/live traffic");
process.exit(pass ? 0 : 1);
