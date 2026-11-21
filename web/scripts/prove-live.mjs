// Live-sandbox proof: 8 free-text scenarios through the LOCAL parser
// and the REAL engine (system/run) — exactly what /api/live does.
// Run from web/:  node scripts/prove-live.mjs
import { parseScenarioLocal, EXAMPLE_PROMPTS } from "../lib/live-scenario.ts";
import { runLiveScenario } from "../lib/live-run.ts";

const texts = process.argv.slice(2);
const cases = texts.length ? texts : EXAMPLE_PROMPTS.map((e) => e.text);

let n = 0;
for (const text of cases) {
  n += 1;
  const parsed = parseScenarioLocal(text);
  const r = await runLiveScenario(parsed.scenario);
  console.log("=".repeat(100));
  console.log(`#${n}  ${text}`);
  console.log("-".repeat(100));
  const { scenario } = parsed;
  console.log(
    `parsed: inst=${scenario.institution}${scenario.institutionAuto ? " (auto)" : ""}` +
      ` | kind=${scenario.customerKind} | activity="${scenario.activity}"` +
      ` | declared=£${scenario.monthlyGbp}/mo | dormant=${scenario.dormant}` +
      ` | listHit=${scenario.listHitCounterparty ?? "-"}`
  );
  for (const p of scenario.payments) {
    console.log(
      `   pay ${p.direction.padEnd(3)} £${String(p.amountGbp).padStart(7)}` +
        `  ${(p.counterparty ?? "(cash)").padEnd(38)} ${p.country.padEnd(22)}` +
        `  ${p.channel.padEnd(13)} day ${p.day} h${p.hour}${p.ownAccount ? " [own]" : ""}`
    );
  }
  for (const d of scenario.docs) {
    console.log(
      `   doc ${d.type.padEnd(14)} party=${d.partyName ?? "-"} £${d.amountGbp ?? "linked"}` +
        `${d.matching ? "" : " [MISMATCH]"}${d.partyDob ? ` dob=${d.partyDob}` : ""}`
    );
  }
  parsed.notes.forEach((m) => console.log(`   note: ${m}`));
  console.log(
    `alerts: ${r.alerts.length ? r.alerts.map((a) => a.rule_id).join(", ") : "(none fired)"}`
  );
  console.log(`VERDICT: ${r.verdict}${r.reason_code ? " " + r.reason_code : ""}  (${r.ms}ms)`);
  console.log(`reason : ${r.reason}`);
}
console.log("=".repeat(100));
