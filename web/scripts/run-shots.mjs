#!/usr/bin/env node
// Screenshots for /run — drives the real page with Playwright against a
// running server. Uses the "investment" sample (smallest dev dataset).
// usage: node scripts/run-shots.mjs [base_url] [out_dir]
//   defaults: http://localhost:3000  ../docs/screens

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const OUT =
  process.argv[3] ||
  resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/screens");
mkdirSync(OUT, { recursive: true });
const SAMPLE = process.env.SHOT_SAMPLE || "investment";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 940 },
  deviceScaleFactor: 2,
});

const shot = (name) => page.screenshot({ path: join(OUT, name) });
console.log(`shots → ${OUT}`);

await page.goto(`${BASE}/run`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await shot("run-upload.png");
console.log("run-upload.png");

// start the smallest sample dataset
await page.click(`text=USE SAMPLE · ${SAMPLE === "payments_fx" ? "PAYMENTS & FX" : SAMPLE.toUpperCase()}`);
await page.waitForTimeout(2500);
// catch mid-run progress (run 2-3 of 5)
for (let i = 0; i < 40; i++) {
  const hasRun3 = await page.locator("text=run 3…").count();
  if (hasRun3) break;
  await page.waitForTimeout(1500);
}
await shot("run-progress.png");
console.log("run-progress.png");

// wait for the whole job to finish — the verdict badge, not caption text
await page.waitForSelector("text=IDENTICAL ✓", { timeout: 600000 });
await page.waitForTimeout(1200);
await shot("run-identical.png");
console.log("run-identical.png");

// scroll the results table into view — first case row, not just its header
const results = page.locator("section", { hasText: "Every case — click a row" });
await results.locator("tbody tr").first().scrollIntoViewIfNeeded();
await page.waitForTimeout(600);
await shot("run-results.png");
console.log("run-results.png");

// open the first case row → the case board
await results.locator("tbody tr").first().click();
await page.waitForSelector("text=RESULTS", { timeout: 30000 });
await page.waitForTimeout(2500);
await shot("run-case.png");
console.log("run-case.png");

await browser.close();
console.log("done");
