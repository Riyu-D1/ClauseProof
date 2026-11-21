// /run job manager — upload → validate → run system/run 5× → hash + report.
//
// Jobs live in memory + temp dirs under os.tmpdir() (never inside the repo).
// Engine invocations are serialised through one global queue: one run at a
// time per job, jobs FIFO — the same discipline as case-run.ts — so the
// demo host never melts and other pages stay responsive.

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import type { Trace, Verdict } from "./types";

const ROOT = resolve(process.cwd(), "..");
const SYSTEM_DIR = join(ROOT, "system");
const RUN_SCRIPT = join(SYSTEM_DIR, "run");
const VALIDATE_SCRIPT = join(SYSTEM_DIR, "validate.py");
const INST_ROOT = join(ROOT, "institutions");

export const RUNS = 5;
const RUN_TIMEOUT_MS = 10 * 60 * 1000;
const JOB_TTL_MS = 60 * 60 * 1000; // cleaned after 1 hour
const MAX_JOBS = 20;
const SAMPLES = ["bank", "emoney", "investment", "payments_fx"] as const;

export interface RunRecord {
  n: number;
  ms: number;
  output_sha256: string;
  trace_sha256: string | null;
}

export interface DatasetJob {
  name: string;
  dir: string;
  cases: number;
  status: "pending" | "running" | "done" | "error";
  current_run: number;
  runs: RunRecord[];
  input_sha256: string | null;
  identical: boolean | null;
  first_diff: { run: number; line: number; a: string; b: string } | null;
  validation: { ok: boolean; errors: string[]; summary: string } | null;
  verdict_counts: Record<Verdict, number> | null;
  top_reason_codes: [string, number][];
  out_dir: string;
  error?: string;
}

export interface Job {
  id: string;
  created: number;
  status: "queued" | "running" | "done" | "error";
  source: "zip" | "folder" | "sample";
  label: string;
  upload_sha256?: string;
  dir: string;
  datasets: DatasetJob[];
  error?: string;
}

const jobs = new Map<string, Job>();

// one global serial queue for engine work — jobs run FIFO, runs inside a
// job run 1..5 in order. Other pages never wait on a run in progress.
let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}

export function queuePosition(job: Job): number {
  if (job.status !== "queued") return 0;
  let pos = 0;
  for (const j of jobs.values()) {
    if (j.status === "queued") pos += 1;
    if (j === job) return pos;
  }
  return pos;
}

// ---------------------------------------------------------------------------
// lifecycle

let lastSweep = 0;
export function sweep() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [id, j] of jobs) {
    if (now - j.created > JOB_TTL_MS) {
      jobs.delete(id);
      rmSync(j.dir, { recursive: true, force: true });
    }
  }
  // bound memory: evict oldest finished jobs past MAX_JOBS
  if (jobs.size > MAX_JOBS) {
    const done = [...jobs.values()]
      .filter((j) => j.status === "done" || j.status === "error")
      .sort((a, b) => a.created - b.created);
    for (const j of done.slice(0, jobs.size - MAX_JOBS)) {
      jobs.delete(j.id);
      rmSync(j.dir, { recursive: true, force: true });
    }
  }
}

export function getJob(id: string): Job | null {
  if (!/^[a-f0-9]{16}$/.test(id)) return null;
  sweep();
  return jobs.get(id) ?? null;
}

/** DELETE /api/run/<id> — forget a finished job and wipe its temp dir now
 *  (jobs also expire on their own after one hour). */
export function deleteJob(id: string): boolean {
  const j = jobs.get(id);
  if (!j || j.status === "running" || j.status === "queued") return false;
  jobs.delete(id);
  rmSync(j.dir, { recursive: true, force: true });
  return true;
}

export function createJob(opts: {
  source: Job["source"];
  label: string;
  datasets: { name: string; dir: string; cases: number }[];
  dir: string;
  upload_sha256?: string;
}): Job {
  sweep();
  const job: Job = {
    id: randomBytes(8).toString("hex"),
    created: Date.now(),
    status: "queued",
    source: opts.source,
    label: opts.label,
    upload_sha256: opts.upload_sha256,
    dir: opts.dir,
    datasets: opts.datasets.map((d) => ({
      name: d.name,
      dir: d.dir,
      cases: d.cases,
      status: "pending",
      current_run: 0,
      runs: [],
      input_sha256: null,
      identical: null,
      first_diff: null,
      validation: null,
      verdict_counts: null,
      top_reason_codes: [],
      out_dir: join(opts.dir, "out", d.name),
    })),
  };
  jobs.set(job.id, job);
  void enqueue(() => processJob(job));
  return job;
}

// ---------------------------------------------------------------------------
// engine plumbing

const sha256File = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");

function spawnWait(
  cmd: string,
  args: string[],
  timeoutMs: number
): Promise<{ code: number; stderr: string; stdout: string }> {
  return new Promise((res, rej) => {
    const child = spawn(cmd, args, {
      cwd: SYSTEM_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const kill = setTimeout(() => {
      child.kill("SIGKILL");
      rej(new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.on("error", (e) => {
      clearTimeout(kill);
      rej(e);
    });
    child.on("close", (code) => {
      clearTimeout(kill);
      res({ code: code ?? -1, stderr, stdout });
    });
  });
}

async function runEngine(dsDir: string, outFile: string): Promise<void> {
  const r = await spawnWait(RUN_SCRIPT, [dsDir, outFile], RUN_TIMEOUT_MS);
  if (r.code !== 0) {
    throw new Error(`engine exited ${r.code}: ${r.stderr.trim().slice(-400)}`);
  }
}

function firstDifferingLine(aPath: string, bPath: string) {
  const a = readFileSync(aPath, "utf8").split("\n");
  const b = readFileSync(bPath, "utf8").split("\n");
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) {
      return {
        line: i + 1,
        a: (a[i] ?? "<missing>").slice(0, 600),
        b: (b[i] ?? "<missing>").slice(0, 600),
      };
    }
  }
  return null;
}

async function validateOutput(dsDir: string, outFile: string) {
  const r = await spawnWait(
    "python3",
    [VALIDATE_SCRIPT, dsDir, outFile],
    120_000
  );
  const out = (r.stdout + r.stderr).trim();
  const errors = out
    .split("\n")
    .filter((l) => l.startsWith("ERR "))
    .map((l) => l.slice(4));
  const summary = out.split("\n").pop() ?? "";
  return { ok: r.code === 0, errors, summary };
}

function traceFileOf(ds: DatasetJob, run: number): string {
  // engine writes <outdir>/traces/<institution-folder-name>.jsonl
  const dir = join(ds.out_dir, `run${run}`, "traces");
  try {
    const f = readdirSync(dir)[0];
    return f ? join(dir, f) : join(dir, `${basename(ds.dir)}.jsonl`);
  } catch {
    return join(dir, `${basename(ds.dir)}.jsonl`);
  }
}

async function processDataset(ds: DatasetJob): Promise<void> {
  ds.status = "running";
  for (let i = 1; i <= RUNS; i++) {
    ds.current_run = i;
    const runDir = join(ds.out_dir, `run${i}`);
    mkdirSync(runDir, { recursive: true });
    const outFile = join(runDir, "out.jsonl");
    const t0 = Date.now();
    await runEngine(ds.dir, outFile);
    const ms = Date.now() - t0;
    const traceFile = traceFileOf(ds, i);
    ds.runs.push({
      n: i,
      ms,
      output_sha256: sha256File(outFile),
      trace_sha256: existsSync(traceFile) ? sha256File(traceFile) : null,
    });
    if (ds.input_sha256 == null) {
      // the engine's own input hash — every trace row carries it
      try {
        const tl = readFileSync(traceFile, "utf8").split("\n").find(Boolean);
        if (tl) ds.input_sha256 = (JSON.parse(tl) as Trace).input_hash;
      } catch {
        /* leave null */
      }
    }
  }

  // reproducibility verdict + first differing line if it ever differs
  const outHashes = new Set(ds.runs.map((r) => r.output_sha256));
  const traceHashes = new Set(ds.runs.map((r) => r.trace_sha256));
  ds.identical = outHashes.size === 1 && traceHashes.size === 1;
  if (!ds.identical) {
    const h1 = ds.runs[0].output_sha256;
    const bad = ds.runs.find((r) => r.output_sha256 !== h1);
    if (bad) {
      const diff = firstDifferingLine(
        join(ds.out_dir, "run1", "out.jsonl"),
        join(ds.out_dir, `run${bad.n}`, "out.jsonl")
      );
      if (diff) ds.first_diff = { run: bad.n, ...diff };
    }
  }

  // official format check on run 1
  ds.validation = await validateOutput(
    ds.dir,
    join(ds.out_dir, "run1", "out.jsonl")
  ).catch((e) => ({
    ok: false,
    errors: [`validator failed to run: ${e instanceof Error ? e.message : e}`],
    summary: "",
  }));

  // verdict counts + top reason codes from run 1's actual output
  const counts: Record<Verdict, number> = { CLOSE: 0, RFI: 0, ESCALATE: 0 };
  const codes = new Map<string, number>();
  for (const line of readFileSync(join(ds.out_dir, "run1", "out.jsonl"), "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (v.verdict in counts) counts[v.verdict as Verdict] += 1;
      if (v.reason_code) codes.set(v.reason_code, (codes.get(v.reason_code) ?? 0) + 1);
    } catch {
      /* validation already reported it */
    }
  }
  ds.verdict_counts = counts;
  ds.top_reason_codes = [...codes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  ds.status = "done";
}

async function processJob(job: Job): Promise<void> {
  job.status = "running";
  try {
    if (!existsSync(RUN_SCRIPT)) throw new Error("system/run not found on this host");
    for (const ds of job.datasets) {
      try {
        await processDataset(ds);
      } catch (e) {
        ds.status = "error";
        ds.error = e instanceof Error ? e.message : String(e);
      }
    }
    writeReport(job);
    job.status = "done";
  } catch (e) {
    job.status = "error";
    job.error = e instanceof Error ? e.message : String(e);
  }
}

function writeReport(job: Job) {
  const report = {
    tool: "ClauseProof /run",
    job_id: job.id,
    generated_at: new Date().toISOString(),
    source: job.source,
    label: job.label,
    upload_sha256: job.upload_sha256 ?? null,
    runs_per_dataset: RUNS,
    engine: { script: "system/run", cwd: "system" },
    datasets: job.datasets.map((ds) => ({
      name: ds.name,
      cases: ds.cases,
      status: ds.status,
      input_sha256: ds.input_sha256,
      runs: ds.runs,
      identical: ds.identical,
      first_diff: ds.first_diff,
      validation: ds.validation,
      verdict_counts: ds.verdict_counts,
      top_reason_codes: ds.top_reason_codes,
      error: ds.error ?? null,
    })),
  };
  try {
    writeFileSync(join(job.dir, "run-report.json"), JSON.stringify(report, null, 2));
  } catch {
    /* report is a convenience, not a failure */
  }
}

// ---------------------------------------------------------------------------
// read-side helpers for the API routes

export function serializeJob(job: Job) {
  return {
    id: job.id,
    status: job.status,
    queue_pos: queuePosition(job),
    source: job.source,
    label: job.label,
    created: job.created,
    expires_at: job.created + JOB_TTL_MS,
    error: job.error ?? null,
    datasets: job.datasets.map((ds) => ({
      name: ds.name,
      cases: ds.cases,
      status: ds.status,
      current_run: ds.current_run,
      runs_total: RUNS,
      runs: ds.runs,
      input_sha256: ds.input_sha256,
      identical: ds.identical,
      first_diff: ds.first_diff,
      validation: ds.validation,
      verdict_counts: ds.verdict_counts,
      top_reason_codes: ds.top_reason_codes,
      error: ds.error ?? null,
    })),
  };
}

function findDataset(job: Job, name: string): DatasetJob | null {
  return job.datasets.find((d) => d.name === name) ?? null;
}

export function getDataset(job: Job, name: string) {
  return findDataset(job, name);
}

/** rows for the results table — run-1 output joined to run-1 traces. */
export function getCaseRows(job: Job, dsName: string) {
  const ds = findDataset(job, dsName);
  if (!ds || ds.status !== "done") return null;
  const outFile = join(ds.out_dir, "run1", "out.jsonl");
  const traceFile = traceFileOf(ds, 1);
  if (!existsSync(outFile)) return [];
  const traces = new Map<string, Trace>();
  if (existsSync(traceFile)) {
    for (const l of readFileSync(traceFile, "utf8").split("\n")) {
      if (!l.trim()) continue;
      try {
        const t = JSON.parse(l) as Trace;
        traces.set(t.case_id, t);
      } catch {
        /* skip */
      }
    }
  }
  const rows = [];
  for (const l of readFileSync(outFile, "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      const v = JSON.parse(l);
      const t = traces.get(v.case_id);
      rows.push({
        case_id: v.case_id,
        alert_ids: v.alert_ids ?? [],
        rules: (t?.alerts ?? []).map((a) => a.rule_id),
        verdict: v.verdict,
        reason_code: v.reason_code,
        reason: v.reason,
        evidence: v.evidence ?? [],
        customer: t?.customer?.name ?? "",
      });
    } catch {
      /* skip malformed */
    }
  }
  return rows;
}

export function getTrace(job: Job, dsName: string, caseId: string): Trace | null {
  const ds = findDataset(job, dsName);
  if (!ds || ds.status !== "done" || !/^[A-Za-z0-9-]+$/.test(caseId)) return null;
  const traceFile = traceFileOf(ds, 1);
  if (!existsSync(traceFile)) return null;
  for (const l of readFileSync(traceFile, "utf8").split("\n")) {
    if (!l.includes(caseId)) continue;
    try {
      const t = JSON.parse(l) as Trace;
      if (t.case_id === caseId) return t;
    } catch {
      /* keep scanning */
    }
  }
  return null;
}

/** evidence document for the case board drawer — same shape as /api/evidence. */
export function getEvidenceDoc(job: Job, dsName: string, docId: string) {
  const ds = findDataset(job, dsName);
  if (!ds || !/^[A-Za-z0-9-]+$/.test(docId)) return null;
  const idxPath = join(ds.dir, "evidence.jsonl");
  if (!existsSync(idxPath)) return null;
  for (const l of readFileSync(idxPath, "utf8").split("\n")) {
    if (!l.includes(docId)) continue;
    try {
      const meta = JSON.parse(l);
      if (meta.doc_id !== docId) continue;
      const mdPath = join(ds.dir, "evidence", basename(String(meta.file)));
      const markdown = existsSync(mdPath) ? readFileSync(mdPath, "utf8") : "";
      return { ...meta, markdown };
    } catch {
      /* keep scanning */
    }
  }
  return null;
}

/** absolute path of a downloadable artefact, or null. Never escapes the job dir. */
export function artefactPath(
  job: Job,
  dsName: string,
  kind: "output" | "traces" | "report"
): { path: string; download: string } | null {
  if (kind === "report") {
    const p = join(job.dir, "run-report.json");
    return existsSync(p) ? { path: p, download: `run-report-${job.id}.json` } : null;
  }
  const ds = findDataset(job, dsName);
  if (!ds || ds.status !== "done") return null;
  if (kind === "output") {
    const p = join(ds.out_dir, "run1", "out.jsonl");
    return existsSync(p) ? { path: p, download: `${ds.name}.jsonl` } : null;
  }
  const p = traceFileOf(ds, 1);
  return existsSync(p)
    ? { path: p, download: `traces-${ds.name}.jsonl` }
    : null;
}

/** dev institutions available server-side for the sample button. */
export function availableSamples() {
  return SAMPLES.filter((id) => existsSync(join(INST_ROOT, id, "cases.jsonl"))).map(
    (id) => ({
      id,
      cases: readFileSync(join(INST_ROOT, id, "cases.jsonl"), "utf8")
        .split("\n")
        .filter((l) => l.trim()).length,
    })
  );
}

export function enginePresent() {
  return existsSync(RUN_SCRIPT);
}

export { INST_ROOT, SAMPLES };
