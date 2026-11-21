/**
 * demo-shots.mjs — fresh screenshots for docs/screens/.
 *   node scripts/demo-shots.mjs [base] [outDir]
 * Captures: demo tab, CLOSE case with the flip toggled, live 5× proof.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2] || "http://localhost:3001";
const out = process.argv[3] || resolve(WEB, "..", "docs", "screens");
const demo = JSON.parse(readFileSync(join(WEB, "public", "data", "demo.json"), "utf8"));
const pick = (slot) => demo.picks.find((p) => p.slot === slot);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(240000);

// 1 — Demo tab
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForTimeout(1400);
await page.screenshot({ path: join(out, "demo-tab.png") });
console.log("demo-tab.png");

// 2 — CLOSE case with flip toggled on
const closePick = pick("close_invoice");
await page.goto(`${base}/case/${closePick.case_id}`, { waitUntil: "networkidle" });
await page.waitForTimeout(2600);
await page.keyboard.press("f");
await page.waitForTimeout(1200);
await page.screenshot({ path: join(out, "case-flip.png") });
console.log("case-flip.png");

// 3 — live 5× proof (investment is the quickest institution)
await page.goto(base, { waitUntil: "networkidle" });
await page.keyboard.press("4"); // investment tab (1=Demo 2=bank 3=emoney 4=investment 5=payments_fx)
await page.click("text=RUN 5×");
await page.waitForSelector("text=total · byte-identical", { timeout: 280000 });
await page.waitForTimeout(600);
await page.screenshot({ path: join(out, "proof-5x.png") });
console.log("proof-5x.png");

await browser.close();
console.log("done →", out);
