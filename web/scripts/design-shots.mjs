// Design-pass screenshots: node scripts/design-shots.mjs <prefix> [baseUrl]
// prefix "before" → docs/screens/design-before-*.png ; "after" → design-after-*.png
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const prefix = process.argv[2] || "after";
const base = process.argv[3] || "http://localhost:3000";
const outdir = new URL("../../docs/screens/", import.meta.url).pathname;
mkdirSync(outdir, { recursive: true });

// deterministic demo picks (from pick-demo.mjs output) + queue + osint
const CLOSE_CASE = "BK-CS118489";
const ESC_CASE = "PX-CS313282";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
  deviceScaleFactor: 2,
});
page.setDefaultTimeout(60000);

// hide the Next.js dev-tools badge — dev-only chrome, not part of the product.
// must re-apply after every goto: React hydration strips init-script styles.
const killBadge = () =>
  page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });

const shot = (name) =>
  page.screenshot({
    path: `${outdir}design-${prefix}-${name}.png`,
    animations: "disabled",
    timeout: 60000,
  });

// 1. queue — demo tab is default; switch to a real institution tab for the list
await page.goto(base, { waitUntil: "networkidle" });
await killBadge();
await page.waitForTimeout(1400);
await shot("queue");

// click the Bank tab (institution list)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  btns.find((b) => /bank/i.test(b.textContent ?? "") && !/payments/i.test(b.textContent ?? ""))?.click();
});
await page.waitForTimeout(1200);
await shot("queue-list");

// 2. CLOSE case — wait for decision path + graph to settle
await page.goto(`${base}/case/${CLOSE_CASE}`, { waitUntil: "networkidle" });
await killBadge();
await page.waitForTimeout(4500);
await shot("case-close");

// 3. ESCALATE case
await page.goto(`${base}/case/${ESC_CASE}`, { waitUntil: "networkidle" });
await killBadge();
await page.waitForTimeout(4500);
await shot("case-escalate");

// 4. OSINT drawer — open via the header button; fire a query for the customer
await page.goto(`${base}/case/${CLOSE_CASE}`, { waitUntil: "networkidle" });
await killBadge();
await page.waitForTimeout(3500);
await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button")];
  btns.find((b) => b.textContent?.toLowerCase().includes("osint"))?.click();
});
await page.waitForTimeout(900);
// click the first subject chip (the customer) so the drawer shows a real state
await page.evaluate(() => {
  document.querySelector("[data-osint-chip]")?.click();
});
await page.waitForTimeout(6000); // osint query (or offline notice) resolves
await shot("osint");

await browser.close();
console.log(`design-${prefix}-*.png → ${outdir}`);
