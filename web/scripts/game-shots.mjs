// Screenshot helper for the game: node scripts/game-shots.mjs [baseUrl] [outdir]
// Captures /play at 390x844 and /stage at 1920x1080.
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:3000";
const out = process.argv[3] || "../docs/screens";

const browser = await chromium.launch();

// /play — phone viewport
const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true });
await phone.goto(`${base}/play`, { waitUntil: "networkidle" });
await phone.waitForTimeout(1200);
await phone.screenshot({ path: `${out}/game-play.png`, fullPage: false });

// /stage — big screen
const stage = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await stage.goto(`${base}/stage`, { waitUntil: "networkidle" });
await stage.waitForTimeout(4500); // poll + graph + decision path settle
await stage.screenshot({ path: `${out}/game-stage.png`, fullPage: false });

await browser.close();
console.log("game shots →", out);
