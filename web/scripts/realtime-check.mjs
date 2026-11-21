// Realtime proof: node scripts/realtime-check.mjs [baseUrl] [outdir]
//
// Opens TWO independent browser contexts on /stage, fires a play through
// POST /api/play (same path a phone takes), and asserts both contexts show
// the new attempt — the second context proves the Supabase realtime insert
// broadcast works. Screenshots → deploy-realtime.png (context A, the
// "projector" view) and deploy-realtime-b.png (context B, a second screen).
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:3100";
const out = process.argv[3] || "../docs/screens";
const NICK = `rt${Math.random().toString(36).slice(2, 8)}`;

const browser = await chromium.launch();
const mk = () =>
  browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const ctxA = await mk();
const ctxB = await mk();
const stageA = await ctxA.newPage();
const stageB = await ctxB.newPage();

await stageA.goto(`${base}/stage`, { waitUntil: "networkidle" });
await stageB.goto(`${base}/stage`, { waitUntil: "networkidle" });
// let the realtime subscription establish (channel join happens after
// /api/play/config resolves)
await stageA.waitForTimeout(3500);

// a play lands — the engine runs server-side, the API inserts into plays
const res = await fetch(`${base}/api/play`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    nickname: NICK,
    persona: "freelancer",
    funding: "cash",
    senders: 16,
    roundAmounts: false,
    ownProof: false,
    hoursToMove: 12,
    parkDays: 30,
    destination: "uk_other",
    newPayeeSameDay: true,
    invoice: "none",
    deviceId: `realtime-check-${Date.now()}`,
  }),
});
const play = await res.json();
console.log("play:", play.verdict, play.reason_code, "→", play.bucket, "| persisted:", play.persisted);

// both contexts must render the attempt — B never initiated anything
const seenIn = async (page, label) => {
  try {
    await page.waitForSelector(`text=${NICK}`, { timeout: 15000 });
    console.log(`PASS ${label} shows ${NICK} (realtime insert visible)`);
    return true;
  } catch {
    console.log(`FAIL ${label} did not show ${NICK} within 15s`);
    return false;
  }
};
const [okA, okB] = [await seenIn(stageA, "context A"), await seenIn(stageB, "context B")];

await stageA.waitForTimeout(1500); // let graph/decision path settle
await stageA.screenshot({ path: `${out}/deploy-realtime.png`, fullPage: false });
await stageB.screenshot({ path: `${out}/deploy-realtime-b.png`, fullPage: false });

const feed = await (await fetch(`${base}/api/play`)).json();
console.log(`feed: source=${feed.source} total=${feed.total} latest=${feed.latest?.nickname}`);

await browser.close();
console.log(okA && okB ? "REALTIME: PASS" : "REALTIME: FAIL");
process.exit(okA && okB ? 0 : 1);
