// livefix proof: screenshots of the new input UX + a real Grok parse.
// Writes docs/screens/livefix-template.png and livefix-grok.png and prints
// the /api/live response metadata (parser, parseMs, verdict) as evidence.
// Run from web/ with the app up:  node scripts/livefix-shots.mjs [base] [outdir]
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:3210";
const out = process.argv[3] || "../docs/screens";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1080 },
  deviceScaleFactor: 2,
});

await page.goto(`${base}/live`, { waitUntil: "networkidle" });

// 1 — template: change a couple of slots, insert, show the live preview
await page.getByRole("button", { name: "[student]" }).click();
await page.getByRole("button", { name: "waiter", exact: true }).click();
await page.getByRole("button", { name: "[United Arab Emirates]" }).click();
await page.getByRole("button", { name: "Russia", exact: true }).click();
await page.getByRole("button", { name: /INSERT INTO BOX/i }).click();
await page.waitForSelector("text=What I understood", { timeout: 10_000 });
await page.waitForTimeout(700); // let the debounced preview render
await page.screenshot({ path: `${out}/livefix-template.png` });
console.log("template screenshot written");

// 2 — run it: capture the API response to prove which parser ran + latency
const respP = page.waitForResponse(
  (r) => new URL(r.url()).pathname === "/api/live" && r.request().method() === "POST",
  { timeout: 90_000 }
);
await page.getByRole("button", { name: /run the engine/i }).click();
const resp = await respP;
const body = await resp.json();
console.log("api/live response:", JSON.stringify({
  parser: body.parser,
  parseMs: body.parseMs,
  llmTag: body.llmTag,
  notes: body.notes,
  verdict: body.result?.verdict,
  reason_code: body.result?.reason_code,
  engineMs: body.result?.ms,
}));
await page.waitForSelector("text=PARSED BY", { timeout: 15_000 });
await page.waitForTimeout(4500); // let decision path animate
await page.screenshot({ path: `${out}/livefix-grok.png`, fullPage: false });
console.log("result screenshot written");

await browser.close();
