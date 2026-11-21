#!/usr/bin/env node
/**
 * nav-shots.mjs — screenshots of the app shell for docs/screens/nav-*.png
 *   node scripts/nav-shots.mjs [base_url] [out_dir]
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const BASE = process.argv[2] || "http://localhost:3000";
const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.argv[3] || join(WEB, "..", "docs", "screens");
mkdirSync(OUT, { recursive: true });

// a real case id for the case pages — first demo pick, else first bank trace
let caseId = null;
try {
  const demo = JSON.parse(readFileSync(join(WEB, "public/data/demo.json"), "utf8"));
  caseId = demo?.picks?.[0]?.case_id ?? null;
} catch { /* fall through */ }
if (!caseId) {
  const bank = JSON.parse(readFileSync(join(WEB, "public/data/bank.json"), "utf8"));
  caseId = bank[0].case_id;
}
console.log("case:", caseId);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
// don't let the first-visit tour steal navigation during the shoot
await page.addInitScript(() => {
  try {
    localStorage.setItem("cp_tour_v1", "done");
  } catch { /* ignore */ }
});
const shot = async (name) => {
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log("  wrote", `${name}.png`);
};

const go = async (path, wait = 1800) => {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(wait);
};

await go("/", 4500); // overview measures real engine runs on first load
await shot("nav-overview");

await go("/queue", 2500);
await shot("nav-queue");

await go(`/case/${caseId}`, 3000);
await shot("nav-case");

// decide live on the multi-check escalate pick — capture mid-animation
await go("/case/PX-CS313282", 2500).catch(() => {});
await page.getByRole("button", { name: /DECIDE LIVE/ }).first().click();
await page.waitForSelector('text=LIVE — decided just now', { timeout: 90000 });
await page.waitForTimeout(1200); // mid-animation: checks still landing
await shot("nav-decide-live");

await go("/live", 2200);
await shot("nav-live");

await go("/proof", 3500);
await shot("nav-proof");

await go("/stage", 2200);
await shot("nav-stage");

// the guided tour overlay, re-opened via the nav "?" button
await go("/", 1200);
await page.evaluate(() => localStorage.removeItem("cp_tour_v1"));
await page.getByTitle("Take the 30-second guided tour").click();
await page.waitForTimeout(1600);
await shot("nav-tour");

await browser.close();
console.log("done");
