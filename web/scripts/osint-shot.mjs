// Screenshot: live OSINT drawer on the case board.
// node scripts/osint-shot.mjs [baseUrl]
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:3105";
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

await page.goto(`${base}/case/PX-CS534207`, { waitUntil: "networkidle" });
await page.waitForTimeout(2500); // let flow graph + decision path settle

// open the OSINT drawer via the header button
await page.getByRole("button", { name: /osint/i }).click();
await page.waitForTimeout(900);

// custom subject: country "Iran" — FATF / UK higher-risk status (live call)
await page.getByPlaceholder("custom subject…").fill("Iran");
await page.getByTitle("toggle subject type").click(); // entity -> country
await page.getByRole("button", { name: "run", exact: true }).click();

// wait for the live result banner + findings
await page.waitForSelector("text=Higher-risk indicators found", { timeout: 45000 });
await page.waitForTimeout(2200); // findings render + scroll settle
await page.screenshot({ path: "../docs/screens/osint.png" });
console.log("saved ../docs/screens/osint.png");

// second pass — entity check on a real-world name (Monzo Bank Ltd)
await page.getByPlaceholder("custom subject…").fill("Monzo Bank Ltd");
await page.getByTitle("toggle subject type").click(); // country -> entity
await page.getByRole("button", { name: "run", exact: true }).click();
await page.waitForSelector("text=Adverse findings", { timeout: 45000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: "../docs/screens/osint-monzo.png" });
console.log("saved ../docs/screens/osint-monzo.png");

await browser.close();
