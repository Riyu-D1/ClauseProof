// Screenshots for the /live sandbox.
// Run from web/ with the dev server up:  node scripts/live-shots.mjs [base] [outdir]
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:3210";
const out = process.argv[3] || "../docs/screens";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 980 },
  deviceScaleFactor: 2,
});

const chip = (label) => page.locator(`button:has-text("${label}")`).first();
const wait = (sel, ms = 90000) => page.waitForSelector(sel, { timeout: ms });

// 1 — empty state
await page.goto(`${base}/live`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await page.screenshot({ path: `${out}/live-empty.png` });

// 2 — ESCALATE: the student (mule-shaped flow)
await chip("The student").click();
await wait("text=ESC_MULE_ACTIVITY");
await page.waitForTimeout(4500); // let the decision path animate through
await page.screenshot({ path: `${out}/live-escalate.png` });

// 3 — CLOSE: the nurse (documented event)
await chip("The inheritance").click();
await wait("text=Monitoring rules that fired");
await page.waitForTimeout(4500);
await page.screenshot({ path: `${out}/live-close.png` });

// 4 — NO ALERT: the café (honest "rules wouldn't have looked")
await chip("The café").click();
await wait("text=the monitoring rules never fired");
await page.waitForTimeout(2200);
await page.screenshot({ path: `${out}/live-noalert.png` });

// 5 — flip before/after: nurse CLOSE → remove the letter → RFI
await chip("The inheritance").click();
await wait("text=Monitoring rules that fired");
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/live-flip-before.png` });
await page.locator("button", { hasText: "remove the" }).first().click();
await wait("text=was CLOSE");
await page.waitForTimeout(4500);
await page.screenshot({ path: `${out}/live-flip-after.png` });

await browser.close();
console.log("screenshots written to", out);
