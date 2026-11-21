// Runs ONE real dataset case through the actual ClauseProof engine
// (system/run) right now. We rebuild a one-case institution folder from
// the untouched dataset rows — same discipline as live-run.ts — so the
// verdict the visitor sees is computed in front of them, not replayed.
// The stored result in output/traces is what the queue shows; if this
// run ever disagrees, the UI says so honestly.

import { spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { Trace, Verdict } from "./types.ts";

const ROOT = resolve(process.cwd(), "..");
const SYSTEM_DIR = join(ROOT, "system");
const INST_ROOT = join(ROOT, "institutions");
const RUN_SCRIPT = join(SYSTEM_DIR, "run");
const VALID_INST = new Set(["bank", "emoney", "investment", "payments_fx"]);
const RUN_TIMEOUT_MS = 60_000;

export interface LiveDecision {
  case_id: string;
  institution: string;
  verdict: Verdict;
  reason_code: string;
  reason: string;
  evidence: string[];
  alert_ids: string[];
  trace: Trace | null;
  engine_version: string;
  input_hash: string;
  ms: number;
  decided_at: string;
}

// serialise engine runs — one laptop, one analyst (same as live-run.ts)
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const p = queue.then(job, job);
  queue = p.catch(() => {});
  return p;
}

const readLines = (p: string) =>
  readFileSync(p, "utf8").split("\n").filter(Boolean);

interface LocatedCase {
  institution: string;
  dir: string;
  line: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: any;
}

/** Locate a case_id across the four real dataset folders. */
export function findDatasetCase(caseId: string): LocatedCase | null {
  if (!/^[A-Za-z0-9-]+$/.test(caseId)) return null;
  for (const inst of VALID_INST) {
    const dir = join(INST_ROOT, inst);
    const casesPath = join(dir, "cases.jsonl");
    if (!existsSync(casesPath)) continue;
    for (const line of readLines(casesPath)) {
      if (!line.includes(caseId)) continue;
      try {
        const row = JSON.parse(line);
        if (row.case_id === caseId) return { institution: inst, dir, line, row };
      } catch {
        /* keep scanning */
      }
    }
  }
  return null;
}

/** Build a temp institution folder holding only this case's slice:
 * the case row, its alerts, its customer, all of that customer's
 * transactions/documents/reviews, the full internal list and POLICY.md —
 * exactly the files the engine is specified to read. */
function writeOneCaseInstitution(loc: LocatedCase): { instDir: string; tmp: string } {
  const tmp = mkdtempSync(join(tmpdir(), "cp-decide-"));
  const instDir = join(tmp, loc.institution); // basename must be the id
  mkdirSync(join(instDir, "evidence"), { recursive: true });
  const realInst = realpathSync(loc.dir);
  const customerId = loc.row.customer_id;
  const alertIds = new Set<string>(loc.row.alert_ids ?? []);

  const filter = (file: string, keep: (row: Record<string, unknown>) => boolean) => {
    const src = join(realInst, file);
    const out: string[] = [];
    if (existsSync(src)) {
      for (const line of readLines(src)) {
        try {
          if (keep(JSON.parse(line))) out.push(line);
        } catch {
          /* skip malformed rows */
        }
      }
    }
    writeFileSync(join(instDir, file), out.length ? out.join("\n") + "\n" : "");
    return out;
  };

  writeFileSync(join(instDir, "cases.jsonl"), loc.line + "\n");
  filter("alerts.jsonl", (a) => alertIds.has(String(a.alert_id)));
  filter("customers.jsonl", (c) => c.customer_id === customerId);
  filter("transactions.jsonl", (t) => t.customer_id === customerId);
  filter("previous_reviews.jsonl", (r) => r.customer_id === customerId);
  const docFiles = filter("evidence.jsonl", (e) => e.customer_id === customerId);
  // full internal list — a TM22 match can point at any entry
  copyFileSync(join(realInst, "internal_list.jsonl"), join(instDir, "internal_list.jsonl"));
  copyFileSync(join(realInst, "POLICY.md"), join(instDir, "POLICY.md"));
  for (const line of docFiles) {
    try {
      const meta = JSON.parse(line);
      const src = join(realInst, "evidence", basename(String(meta.file)));
      if (existsSync(src)) copyFileSync(src, join(instDir, "evidence", basename(src)));
    } catch {
      /* skip */
    }
  }
  return { instDir, tmp };
}

function runEngine(instDir: string, outFile: string): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(RUN_SCRIPT, [instDir, outFile], {
      cwd: SYSTEM_DIR,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const kill = setTimeout(() => {
      child.kill("SIGKILL");
      rej(new Error("engine timed out"));
    }, RUN_TIMEOUT_MS);
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(kill);
      rej(e);
    });
    child.on("close", (code) => {
      clearTimeout(kill);
      if (code === 0) res();
      else rej(new Error(`engine exited ${code}: ${err.trim().slice(-300)}`));
    });
  });
}

/** The live one-case decision. Throws if the case or engine is missing. */
export function decideCaseLive(caseId: string): Promise<LiveDecision> {
  return enqueue(async () => {
    if (!existsSync(RUN_SCRIPT)) throw new Error("engine not found on this machine");
    const loc = findDatasetCase(caseId);
    if (!loc) throw new Error(`case ${caseId} is not in the dataset`);
    const t0 = Date.now();
    const { instDir, tmp } = writeOneCaseInstitution(loc);
    const outFile = join(tmp, "out.jsonl");
    try {
      await runEngine(instDir, outFile);
      const line = readFileSync(outFile, "utf8").split("\n").find(Boolean);
      if (!line) throw new Error("engine wrote no verdict");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = JSON.parse(line) as any;
      let trace: Trace | null = null;
      const traceFile = join(tmp, "traces", `${loc.institution}.jsonl`);
      if (existsSync(traceFile)) {
        const tl = readFileSync(traceFile, "utf8").split("\n").find(Boolean);
        if (tl) trace = JSON.parse(tl) as Trace;
      }
      return {
        case_id: caseId,
        institution: loc.institution,
        verdict: v.verdict,
        reason_code: v.reason_code,
        reason: v.reason,
        evidence: v.evidence ?? [],
        alert_ids: v.alert_ids ?? loc.row.alert_ids ?? [],
        trace,
        engine_version: trace?.engine_version ?? "unknown",
        input_hash: trace?.input_hash ?? "",
        ms: Date.now() - t0,
        decided_at: new Date().toISOString(),
      };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}

export interface TimingSample {
  available: boolean;
  samples: { institution: string; case_id: string; ms: number }[];
  mean_ms: number | null;
  measured_at: string;
  note?: string;
}

let timingCache: Promise<TimingSample> | null = null;

/** Mean decide time, measured by really running the engine on a small
 * deterministic sample (2 evenly spaced cases per institution). Never
 * invented — if the engine can't run here, available=false. Memoised per
 * server process so the overview only pays the ~seconds cost once. */
export function sampleEngineTiming(): Promise<TimingSample> {
  if (timingCache) return timingCache;
  timingCache = (async () => {
    const measured_at = new Date().toISOString();
    if (!existsSync(RUN_SCRIPT) || !existsSync(INST_ROOT)) {
      return {
        available: false,
        samples: [],
        mean_ms: null,
        measured_at,
        note: "engine or dataset not present on this host",
      };
    }
    const samples: { institution: string; case_id: string; ms: number }[] = [];
    for (const inst of VALID_INST) {
      const casesPath = join(INST_ROOT, inst, "cases.jsonl");
      if (!existsSync(casesPath)) continue;
      const ids = readLines(casesPath)
        .map((l) => {
          try {
            return JSON.parse(l).case_id as string;
          } catch {
            return null;
          }
        })
        .filter((x): x is string => !!x);
      // evenly spaced, deterministic — not cherry-picked for speed
      const picks = [ids[Math.floor(ids.length / 3)], ids[Math.floor((2 * ids.length) / 3)]].filter(Boolean);
      for (const case_id of picks) {
        try {
          const r = await decideCaseLive(case_id);
          samples.push({ institution: inst, case_id, ms: r.ms });
        } catch {
          /* an engine failure just skips the sample */
        }
      }
    }
    const mean_ms = samples.length
      ? Math.round(samples.reduce((s, x) => s + x.ms, 0) / samples.length)
      : null;
    return {
      available: samples.length > 0,
      samples,
      mean_ms,
      measured_at,
      note:
        samples.length > 0
          ? `mean of ${samples.length} one-case engine runs on this host (includes interpreter start-up)`
          : "engine ran no sample successfully",
    };
  })().catch(() => ({
    available: false,
    samples: [],
    mean_ms: null,
    measured_at: new Date().toISOString(),
    note: "timing sample failed",
  }));
  return timingCache;
}
