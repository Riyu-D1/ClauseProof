// Runs one synthetic game case through the real ClauseProof engine and
// keeps the attempts feed (in-memory) for the stage leaderboard.

import { spawn } from "node:child_process";
import { createSocket } from "node:dgram";
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync,
  readFileSync, realpathSync, rmSync, writeFileSync,
} from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir, networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import type { CoverageRow, Trace } from "./types";
import type { DestDef, Persona, PlayInput, Verdict } from "./play";
import { buildSyntheticCase, type SyntheticCase } from "./play-case";

const ROOT = resolve(process.cwd(), "..");
const SYSTEM_DIR = join(ROOT, "system");
const INST_ROOT = join(ROOT, "institutions");
const RUN_SCRIPT = join(SYSTEM_DIR, "run");
const RUN_TIMEOUT_MS = 60_000;

/* ------------------------------ store ----------------------------------- */

export type Bucket = "CAUGHT" | "QUESTIONED" | "GOT AWAY";

export interface AttemptAlert {
  rule_id: string;
  rule_name: string;
  message: string;
  transaction_ids: string[];
}

export interface Attempt {
  id: string;
  seq: number;
  ts: number;
  nickname: string;
  persona: string;
  institution: string;
  bucket: Bucket;
  verdict: Verdict;
  reason_code: string | null;
  reason: string | null;
  evidence: string[];
  alerts: AttemptAlert[];
  alert_count: number;
  flagged_gbp: number;
  flip: { change: string; new_verdict: string } | null;
  context: string[];
  summary: string;
  trace: Trace | null;
  synthetic: true;
}

interface Store {
  attempts: Attempt[];
  seq: number;
  devices: Map<string, number[]>;
}

const g = globalThis as unknown as { __cpPlay?: Store };
if (!g.__cpPlay) g.__cpPlay = { attempts: [], seq: 0, devices: new Map() };
const store = g.__cpPlay;

const MAX_ATTEMPTS = 60;
const PLAYS_PER_HOUR = 24;
const MIN_INTERVAL_MS = 2500;

export function rateLimit(deviceId: string): string | null {
  const now = Date.now();
  const hits = (store.devices.get(deviceId) ?? []).filter((t) => now - t < 3600_000);
  const last = hits[hits.length - 1] ?? 0;
  if (now - last < MIN_INTERVAL_MS) return "too fast — give the analyst a second";
  if (hits.length >= PLAYS_PER_HOUR) return `rate limit: ${PLAYS_PER_HOUR} plays/hour per device`;
  hits.push(now);
  store.devices.set(deviceId, hits);
  return null;
}

export function getFeed() {
  const attempts = store.attempts;
  const latest = attempts[0] ?? null;
  const board: Record<Bucket, { nickname: string; summary: string; reason_code: string | null }[]> = {
    "CAUGHT": [],
    "QUESTIONED": [],
    "GOT AWAY": [],
  };
  for (const a of attempts) {
    board[a.bucket].push({ nickname: a.nickname, summary: a.summary, reason_code: a.reason_code });
  }
  return {
    total: attempts.length,
    latest,
    attempts: attempts.map((a) => {
      const { trace, ...meta } = a;
      void trace;
      return meta;
    }),
    board,
  };
}

function addAttempt(a: Omit<Attempt, "id" | "seq" | "ts" | "synthetic">): Attempt {
  const attempt: Attempt = {
    ...a,
    id: `att-${Date.now().toString(36)}-${store.seq}`,
    seq: ++store.seq,
    ts: Date.now(),
    synthetic: true,
  };
  store.attempts.unshift(attempt);
  if (store.attempts.length > MAX_ATTEMPTS) store.attempts.length = MAX_ATTEMPTS;
  return attempt;
}

/* ---------------------------- engine runner ------------------------------ */

// serialise engine runs — one laptop, one analyst
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const p = queue.then(job, job);
  queue = p.catch(() => {});
  return p;
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

function writeCase(sc: SyntheticCase): { instDir: string; tmp: string } {
  const tmp = mkdtempSync(join(tmpdir(), "cp-play-"));
  const instDir = join(tmp, sc.institution); // basename must be the institution id
  mkdirSync(join(instDir, "evidence"), { recursive: true });
  const realInst = realpathSync(join(INST_ROOT, sc.institution));
  for (const [rel, content] of Object.entries(sc.files)) {
    const p = join(instDir, rel);
    if (content === "@@POLICY@@") {
      copyFileSync(join(realInst, "POLICY.md"), p);
    } else if (content === "@@INTERNAL_LIST@@") {
      copyFileSync(join(realInst, "internal_list.jsonl"), p);
    } else {
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, content);
    }
  }
  return { instDir, tmp };
}

/** Build a display trace for attempts where no alert fired — the bank
 * never opened a file, so there is no engine trace to show. */
function noAlertTrace(sc: SyntheticCase, persona: Persona): Trace {
  const cust = persona.customer as { name: string; kind: string };
  const coverage: CoverageRow[] = sc.txns.map((t) => ({
    transaction_id: t.transaction_id,
    amount_gbp: t.amount_gbp,
    direction: t.direction,
    counterparty: t.counterparty_name ?? (t.channel.startsWith("cash") ? "cash deposit" : "unknown"),
    country: t.counterparty_country,
    booked_at: t.booked_at,
    covered_by: null,
    why: "not reviewed — no monitoring rule fired",
  }));
  return {
    case_id: sc.caseId,
    institution: sc.institution,
    customer: {
      id: "PLAY-C001",
      name: cust.name,
      kind: cust.kind,
      occupation_or_activity:
        (persona.customer.occupation as string) ??
        (persona.customer.business_activity as string) ?? null,
      declared_monthly_gbp: persona.declaredMonthlyGbp,
      expected_countries:
        (persona.customer.declared as { expected_countries?: string[] })
          ?.expected_countries ?? [],
      held_payment_id: sc.heldPaymentId,
      review_window: { from: "2026-10-01", to: "2026-10-31" },
    },
    verdict: "CLOSE",
    reason_code: "WITHIN_PROFILE",
    reason: "No monitoring rule fired on this activity, so no alert was raised and no review was opened.",
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

/* ------------------------------- play ----------------------------------- */

export interface PlayOutcome {
  attempt: Attempt;
  ranEngine: boolean;
}

export function submitPlay(
  input: PlayInput, persona: Persona, dest: DestDef
): Promise<PlayOutcome> {
  return enqueue(async () => {
    const sc = buildSyntheticCase(input, persona, dest, store.seq + 1);
    const alertedIds = new Set(sc.alerts.flatMap((a) => a.transaction_ids));
    const flagged = sc.txns
      .filter((t) => alertedIds.size === 0 || alertedIds.has(t.transaction_id))
      .reduce((s, t) => s + t.amount_gbp, 0);

    if (sc.alerts.length === 0) {
      // no rule fired — honest escape, the bank never looked
      const attempt = addAttempt({
        nickname: input.nickname,
        persona: persona.id,
        institution: sc.institution,
        bucket: "GOT AWAY",
        verdict: "NO_ALERT",
        reason_code: null,
        reason: "No alert raised — the monitoring rules never fired, so the bank wouldn't have looked.",
        evidence: [],
        alerts: [],
        alert_count: 0,
        flagged_gbp: flagged,
        flip: null,
        context: sc.context,
        summary: sc.summary,
        trace: noAlertTrace(sc, persona),
      });
      return { attempt, ranEngine: false };
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
      const bucket: Bucket =
        verdict.verdict === "ESCALATE" ? "CAUGHT" : verdict.verdict === "RFI" ? "QUESTIONED" : "GOT AWAY";
      const attempt = addAttempt({
        nickname: input.nickname,
        persona: persona.id,
        institution: sc.institution,
        bucket,
        verdict: verdict.verdict,
        reason_code: verdict.reason_code,
        reason: verdict.reason,
        evidence: verdict.evidence,
        alerts: sc.alerts.map((a) => ({
          rule_id: a.rule_id, rule_name: a.rule_name,
          message: a.message, transaction_ids: a.transaction_ids,
        })),
        alert_count: sc.alerts.length,
        flagged_gbp: flagged,
        flip: trace?.flip ?? null,
        context: sc.context,
        summary: sc.summary,
        trace,
      });
      return { attempt, ranEngine: true };
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
}

/* ------------------------------ config ----------------------------------- */

/** Source IP the OS would use for an outbound (default-route) packet —
 * i.e. the LAN address phones on the same network can reach. A UDP
 * "connect" only does a route lookup; nothing is sent, so it works
 * offline too. */
function defaultRouteIp(): Promise<string | null> {
  return new Promise((res) => {
    try {
      const s = createSocket("udp4");
      const bail = () => {
        try {
          s.close();
        } catch {
          /* closed */
        }
        res(null);
      };
      const timer = setTimeout(bail, 1500);
      timer.unref();
      s.on("error", bail);
      s.connect(80, "192.0.2.1", () => {
        clearTimeout(timer);
        try {
          const a = (s.address() as AddressInfo)?.address;
          s.close();
          res(a && a !== "0.0.0.0" ? a : null);
        } catch {
          res(null);
        }
      });
    } catch {
      res(null);
    }
  });
}

const VIRTUAL_IFACE =
  /^(lo|bridge|utun|vmnet|vboxnet|veth|docker|gif|stf|awdl|llw|anpi|ap|ham|tun|tap|ipsec|ppp|wg)/i;

export async function lanUrl(port: string | number): Promise<string> {
  const pub = process.env.PUBLIC_URL?.trim();
  if (pub) return pub.replace(/\/$/, "");
  const viaRoute = await defaultRouteIp();
  if (viaRoute) return `http://${viaRoute}:${port}`;
  const nets = networkInterfaces();
  // physical interfaces first — virtual ones (bridge/utun/vmnet/…) are
  // never reachable from phones on the LAN
  const names = Object.keys(nets).sort(
    (a, b) => Number(VIRTUAL_IFACE.test(a)) - Number(VIRTUAL_IFACE.test(b))
  );
  for (const name of names) {
    for (const n of nets[name] ?? []) {
      if (n.family === "IPv4" && !n.internal) {
        return `http://${n.address}:${port}`;
      }
    }
  }
  return `http://localhost:${port}`;
}
