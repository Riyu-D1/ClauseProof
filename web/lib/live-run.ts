// Runs one LiveScenario through the real ClauseProof engine
// (system/run) on a throwaway institution folder. Same discipline as
// play-run.ts but standalone: no game state, no feed, just the case.

import { spawn } from "node:child_process";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync,
  readFileSync, realpathSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { CoverageRow, Trace } from "./types.ts";
import { buildLiveCase, CUST_ID, type LiveCase } from "./live-case.ts";
import type { LiveScenario } from "./live-scenario.ts";

const ROOT = resolve(process.cwd(), "..");
const SYSTEM_DIR = join(ROOT, "system");
const INST_ROOT = join(ROOT, "institutions");
const RUN_SCRIPT = join(SYSTEM_DIR, "run");
const RUN_TIMEOUT_MS = 60_000;

export interface LiveAlertOut {
  rule_id: string;
  rule_name: string;
  message: string;
  transaction_ids: string[];
}

export interface LiveResult {
  verdict: "CLOSE" | "RFI" | "ESCALATE" | "NO_ALERT";
  reason_code: string | null;
  reason: string;
  evidence: string[];
  alerts: LiveAlertOut[];
  /** transaction ids any alert fired on */
  flaggedTxnIds: string[];
  flaggedGbp: number;
  trace: Trace | null;
  docTexts: Record<string, string>;
  context: string[];
  heldPaymentId: string | null;
  ranEngine: boolean;
  ms: number;
  /** payment.id -> transaction_id, for mapping coverage back to the card */
  paymentTxnMap: Record<string, string>;
}

// serialise engine runs — one laptop, one analyst
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const p = queue.then(job, job);
  queue = p.catch(() => {});
  return p;
}

function runEngine(instDir: string, outFile: string): Promise<void> {
  return new Promise((res, rej) => {
    const child = spawn(RUN_SCRIPT, ["--trace-dir", join(dirname(outFile), "traces"), instDir, outFile], {
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

function writeCase(sc: LiveCase): { instDir: string; tmp: string } {
  const tmp = mkdtempSync(join(tmpdir(), "cp-live-"));
  const instDir = join(tmp, sc.institution); // basename must be the id
  mkdirSync(join(instDir, "evidence"), { recursive: true });
  const realInst = realpathSync(join(INST_ROOT, sc.institution));
  for (const [rel, content] of Object.entries(sc.files)) {
    const p = join(instDir, rel);
    if (content === "@@POLICY@@") {
      copyFileSync(join(realInst, "POLICY.md"), p);
    } else {
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, content);
    }
  }
  return { instDir, tmp };
}

/** A display trace for honest no-alert runs: the rules never fired, so
 * there is nothing for the engine to review. */
function noAlertTrace(sc: LiveCase, s: LiveScenario): Trace {
  const coverage: CoverageRow[] = sc.txns.map((t) => ({
    transaction_id: t.transaction_id,
    amount_gbp: t.amount_gbp,
    direction: t.direction,
    counterparty:
      t.counterparty_name ?? (t.channel.startsWith("cash") ? "cash" : "unknown"),
    country: t.counterparty_country,
    booked_at: t.booked_at,
    covered_by: null,
    why: "not reviewed — no monitoring rule fired",
  }));
  return {
    case_id: sc.caseId,
    institution: sc.institution,
    customer: {
      id: CUST_ID,
      name: sc.custName,
      kind: sc.custKind,
      occupation_or_activity: s.activity,
      declared_monthly_gbp: s.monthlyGbp,
      expected_countries: s.expectedCountries,
      held_payment_id: null,
      review_window: { from: "2026-10-01", to: "2026-10-31" },
    },
    verdict: "CLOSE",
    reason_code: "WITHIN_PROFILE",
    reason:
      "No monitoring rule fired on this activity, so no alert was raised and no review was opened.",
    evidence: [],
    alerts: [],
    coverage,
    checks: [],
    flip: null,
    risk_context: [],
    engine_version: "no-run",
    input_hash: "",
  };
}

export function runLiveScenario(s: LiveScenario): Promise<LiveResult> {
  return enqueue(async () => {
    const t0 = Date.now();
    const sc = buildLiveCase(s);
    const alertedIds = new Set(sc.alerts.flatMap((a) => a.transaction_ids));
    const flagged = sc.txns
      .filter((t) => alertedIds.size === 0 || alertedIds.has(t.transaction_id))
      .reduce((s2, t) => s2 + t.amount_gbp, 0);
    const alertsOut: LiveAlertOut[] = sc.alerts.map((a) => ({
      rule_id: a.rule_id,
      rule_name: a.rule_name,
      message: a.message,
      transaction_ids: a.transaction_ids,
    }));

    if (sc.alerts.length === 0) {
      return {
        verdict: "NO_ALERT",
        reason_code: null,
        reason:
          "No alert raised — the monitoring rules never fired, so the bank wouldn't have looked.",
        evidence: [],
        alerts: [],
        flaggedTxnIds: [],
        flaggedGbp: flagged,
        trace: noAlertTrace(sc, s),
        docTexts: sc.docTexts,
        context: sc.context,
        heldPaymentId: null,
        ranEngine: false,
        ms: Date.now() - t0,
        paymentTxnMap: Object.fromEntries(sc.txnIdByPaymentId),
      };
    }

    const { instDir, tmp } = writeCase(sc);
    const outFile = join(tmp, "out.jsonl");
    try {
      await runEngine(instDir, outFile);
      const line = readFileSync(outFile, "utf8").split("\n").find(Boolean);
      if (!line) throw new Error("engine wrote no verdict");
      const verdict = JSON.parse(line) as {
        verdict: "CLOSE" | "RFI" | "ESCALATE";
        reason_code: string;
        reason: string;
        evidence: string[];
      };
      let trace: Trace | null = null;
      const traceFile = join(tmp, "traces", `${sc.institution}.jsonl`);
      if (existsSync(traceFile)) {
        const tl = readFileSync(traceFile, "utf8").split("\n").find(Boolean);
        if (tl) trace = JSON.parse(tl) as Trace;
      }
      return {
        verdict: verdict.verdict,
        reason_code: verdict.reason_code,
        reason: verdict.reason,
        evidence: verdict.evidence,
        alerts: alertsOut,
        flaggedTxnIds: [...alertedIds],
        flaggedGbp: flagged,
        trace,
        docTexts: sc.docTexts,
        context: sc.context,
        heldPaymentId: sc.heldPaymentId,
        ranEngine: true,
        ms: Date.now() - t0,
        paymentTxnMap: Object.fromEntries(sc.txnIdByPaymentId),
      };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}
