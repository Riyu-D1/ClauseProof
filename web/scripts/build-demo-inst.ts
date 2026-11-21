// Generates demo/institutions/<inst>/ — small SYNTHETIC institution folders
// built by the game's own case generator (web/lib/play-case.ts). They are
// committed to the repo so the hosted deploy can run real, live engine
// proof-runs and game plays without the private dataset. POLICY.md is copied
// verbatim from the dataset (policy text is safe to ship); internal_list.jsonl
// is a tiny invented list — no dataset rows are included.
//
//   npm run build:demo-inst        (from web/)
//   tsx scripts/build-demo-inst.ts

import {
  cpSync, existsSync, mkdirSync,
  rmSync, writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { PERSONAS, type DestDef, type Persona, type PlayInput } from "../lib/play";
import { buildSyntheticCase, type SyntheticCase } from "../lib/play-case";

const WEB = resolve(import.meta.dirname, "..");
const ROOT = resolve(WEB, "..");
const OUT_ROOT = join(ROOT, "demo", "institutions");
const REAL_INST_ROOT = join(ROOT, "institutions");

type Scenario = Partial<PlayInput> & { funding: PlayInput["funding"]; destination: string };

const BASE: Omit<PlayInput, "funding" | "destination" | "nickname" | "persona" | "deviceId"> = {
  senders: 8,
  roundAmounts: false,
  ownProof: false,
  hoursToMove: 24,
  parkDays: 30,
  newPayeeSameDay: true,
  invoice: "none",
};

// a spread of plays per persona — some clean, some engineered to trip rules
const SCENARIOS: Record<string, Scenario[]> = {
  teacher: [
    { funding: "crowd", senders: 10, roundAmounts: true, hoursToMove: 12, destination: "uk_other" },
    { funding: "cash", senders: 16, hoursToMove: 12, destination: "uk_other" },
    { funding: "own", hoursToMove: 30, destination: "high_risk", invoice: "matching" },
    { funding: "crowd", senders: 4, hoursToMove: 96, destination: "eu" },
    { funding: "own", hoursToMove: 20, destination: "uk_own", ownProof: true },
    { funding: "cash", senders: 3, hoursToMove: 240, destination: "uk_other" },
  ],
  freelancer: [
    { funding: "cash", senders: 16, hoursToMove: 12, destination: "uk_other" },
    { funding: "crowd", senders: 12, hoursToMove: 18, destination: "uk_other" },
    { funding: "own", hoursToMove: 72, destination: "uk_own", ownProof: true },
    { funding: "crowd", senders: 6, hoursToMove: 12, destination: "high_risk" },
    { funding: "cash", senders: 4, hoursToMove: 30, destination: "eu" },
    { funding: "crowd", senders: 2, hoursToMove: 400, destination: "uk_other" },
  ],
  investor: [
    { funding: "crowd", senders: 8, hoursToMove: 24, destination: "uk_other" },
    { funding: "own", hoursToMove: 30, destination: "fund_park", parkDays: 10 },
    { funding: "crowd", senders: 3, hoursToMove: 48, destination: "high_risk" },
    { funding: "own", hoursToMove: 200, destination: "uk_own", ownProof: true },
    { funding: "crowd", senders: 12, hoursToMove: 6, destination: "fund_park", parkDays: 5 },
  ],
  baker: [
    { funding: "crowd", senders: 10, hoursToMove: 24, destination: "eu", invoice: "matching" },
    { funding: "own", hoursToMove: 30, destination: "high_risk", invoice: "matching" },
    { funding: "own", hoursToMove: 30, destination: "tr", invoice: "mismatch" },
    { funding: "crowd", senders: 20, hoursToMove: 12, destination: "eu" },
    { funding: "own", hoursToMove: 50, destination: "uk_own", ownProof: true },
    { funding: "crowd", senders: 5, hoursToMove: 60, destination: "high_risk", invoice: "none" },
  ],
};

// per-case id namespacing so merged rows stay unique within a folder
function rekey(sc: SyntheticCase, seq: number): SyntheticCase {
  const map: [RegExp, string][] = [
    [/PLAY-C001/g, `PLAY-C${seq}`],
    [/PLAY-A001/g, `PLAY-A${seq}`],
    [/PLAY-AL/g, `PLAY-AL${seq}-`],
    [/PLAY-T/g, `PLAY-T${seq}-`],
    [/INV-9001/g, `INV-9${seq}01`],
    [/STM-9001/g, `STM-9${seq}01`],
  ];
  const files: Record<string, string> = {};
  for (const [rel, content] of Object.entries(sc.files)) {
    let k = rel, v = content;
    for (const [re, to] of map) {
      k = k.replace(re, to);
      v = v.replace(re, to);
    }
    files[k] = v;
  }
  return { ...sc, files };
}

const MERGED = [
  "cases.jsonl", "alerts.jsonl", "customers.jsonl", "transactions.jsonl",
  "evidence.jsonl", "previous_reviews.jsonl",
];

const DEMO_LIST = (inst: string) =>
  JSON.stringify({
    entry_id: `DEMO-${inst.slice(0, 2).toUpperCase()}-L001`,
    kind: "individual",
    name: "Ivo Pennhaligan",
    date_of_birth: "1948-02-11",
    identifiers: { internal_case: "IC-2024-0001" },
    address: "1 Demo Row, Testham, TE1 1AA",
    reason: "bundled demo entry — invented, matches nothing",
    listed_on: "2024-01-05",
  }) + "\n";

function main() {
  for (const persona of PERSONAS as Persona[]) {
    const inst = persona.institution;
    const outDir = join(OUT_ROOT, inst);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(join(outDir, "evidence"), { recursive: true });

    const merged: Record<string, string> = Object.fromEntries(MERGED.map((f) => [f, ""]));
    const docs: Record<string, string> = {};
    const cases: { id: string; alerts: number; summary: string }[] = [];

    const scenarios = SCENARIOS[persona.id] ?? [];
    scenarios.forEach((s, i) => {
      const seq = i + 1;
      const dest = persona.destinations.find((d) => d.id === s.destination) as DestDef;
      const input: PlayInput = {
        ...BASE, ...s,
        nickname: `demo${seq}`,
        persona: persona.id,
        destination: dest.id,
        deviceId: `demo-${inst}-${seq}`,
      };
      const sc = rekey(buildSyntheticCase(input, persona, dest, seq), seq);
      cases.push({ id: sc.caseId, alerts: sc.alerts.length, summary: sc.summary });
      for (const [rel, content] of Object.entries(sc.files)) {
        if (rel in merged) merged[rel] += content;
        else if (rel === "POLICY.md" || rel === "internal_list.jsonl") continue;
        else docs[rel] = content;
      }
    });

    for (const [rel, content] of Object.entries(merged)) {
      writeFileSync(join(outDir, rel), content);
    }
    for (const [rel, content] of Object.entries(docs)) {
      writeFileSync(join(outDir, rel), content);
    }

    // POLICY.md verbatim from the dataset when available; internal list is synthetic
    const policySrc = join(REAL_INST_ROOT, inst, "POLICY.md");
    if (existsSync(policySrc)) cpSync(policySrc, join(outDir, "POLICY.md"));
    writeFileSync(join(outDir, "internal_list.jsonl"), DEMO_LIST(inst));

    console.log(`${inst}: ${cases.length} cases → ${outDir.replace(ROOT + "/", "")}`);
    for (const c of cases) console.log(`   ${c.id}  alerts=${c.alerts}  ${c.summary}`);
    if (!existsSync(policySrc)) console.log("   ! POLICY.md not found — bundled placeholder missing");
  }
}

main();
