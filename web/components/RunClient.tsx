"use client";

// /run — "Test it on your own data". A judge should be able to drop a zip
// (or pick a folder, or click a sample) and watch the real system/run go
// 5 times on their files, with SHA-256 proof the reasoning is identical.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RunCaseBoard from "@/components/RunCaseBoard";
import VerdictPill from "@/components/VerdictPill";
import { VERDICT_COLOR } from "@/lib/format";
import type { Trace, Verdict } from "@/lib/types";

// ---------------------------------------------------------------- types

interface RunRec {
  n: number;
  ms: number;
  output_sha256: string;
  trace_sha256: string | null;
}

interface DsStatus {
  name: string;
  cases: number;
  status: "pending" | "running" | "done" | "error";
  current_run: number;
  runs_total: number;
  runs: RunRec[];
  input_sha256: string | null;
  identical: boolean | null;
  first_diff: { run: number; line: number; a: string; b: string } | null;
  validation: { ok: boolean; errors: string[]; summary: string } | null;
  verdict_counts: Record<Verdict, number> | null;
  top_reason_codes: [string, number][];
  error: string | null;
}

interface JobStatus {
  id: string;
  status: "queued" | "running" | "done" | "error";
  queue_pos: number;
  source: string;
  label: string;
  datasets: DsStatus[];
  error: string | null;
}

interface CaseRow {
  case_id: string;
  alert_ids: string[];
  rules: string[];
  verdict: Verdict;
  reason_code: string;
  reason: string;
  evidence: string[];
  customer: string;
}

interface Issue {
  dataset?: string;
  file: string;
  line?: number;
  message: string;
}

interface Samples {
  engine: boolean;
  samples: { id: string; cases: number }[];
}

const VERDICTS: Verdict[] = ["CLOSE", "RFI", "ESCALATE"];
const SAMPLE_LABEL: Record<string, string> = {
  bank: "BANK",
  emoney: "E-MONEY",
  investment: "INVESTMENT",
  payments_fx: "PAYMENTS & FX",
};
const POLL_MS = 900;
const MAX_UPLOAD = 50 * 1024 * 1024;

const BTN =
  "mono flex h-9 items-center justify-center rounded-md border border-line px-4 text-[10.5px] font-bold tracking-[0.12em] text-ink-300 transition-colors hover:border-accent hover:text-ink-100 disabled:opacity-40";

function Hash({ value, label }: { value: string | null; label?: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="mono text-[10px] text-ink-600">—</span>;
  return (
    <button
      className="mono inline-flex max-w-full items-center gap-1 text-[10px] text-ink-300 transition-colors hover:text-accent"
      title={`${label ? label + " — " : ""}${value} (click to copy)`}
      onClick={() => {
        navigator.clipboard?.writeText(value).catch(() => {});
        setCopied(true);
        window.setTimeout(() => setCopied(false), 900);
      }}
    >
      <span className="truncate">{copied ? "copied!" : `${value.slice(0, 20)}…`}</span>
    </button>
  );
}

// ---------------------------------------------------------------- page

export default function RunClient() {
  const [avail, setAvail] = useState<Samples | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [job, setJob] = useState<JobStatus | null>(null);
  const [dsTab, setDsTab] = useState<string>("");
  const [rows, setRows] = useState<Record<string, CaseRow[]>>({});
  const [query, setQuery] = useState("");
  const [vFilter, setVFilter] = useState<Verdict | null>(null);
  const [selected, setSelected] = useState<{ ds: string; caseId: string } | null>(null);
  const [trace, setTrace] = useState<Trace | null>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    fetch("/api/run", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAvail(d))
      .catch(() => setAvail(null));
  }, []);

  // ---- submit -----------------------------------------------------------
  const submit = useCallback(async (body: FormData | { sample: string }) => {
    setBusy(true);
    setErr(null);
    setIssues([]);
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        body: body instanceof FormData ? body : JSON.stringify(body),
        headers: body instanceof FormData ? undefined : { "content-type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        setErr(data.error ?? `HTTP ${res.status}`);
        if (Array.isArray(data.issues)) setIssues(data.issues);
        return;
      }
      setJobId(data.job_id);
      setJob(null);
      setRows({});
      setDsTab("");
      setSelected(null);
      setTrace(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const onZip = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      if (file.size > MAX_UPLOAD) {
        setErr(`"${file.name}" is ${(file.size / (1 << 20)).toFixed(1)}MB — the limit is 50MB`);
        return;
      }
      const fd = new FormData();
      fd.append("file", file, file.name || "upload.zip");
      void submit(fd);
    },
    [submit]
  );

  const onFolder = useCallback(
    (list: FileList | null) => {
      if (!list?.length) return;
      let total = 0;
      const fd = new FormData();
      for (const f of Array.from(list)) {
        total += f.size;
        const rel =
          (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        fd.append("files", f, rel);
      }
      if (total > MAX_UPLOAD) {
        setErr(`folder is ${(total / (1 << 20)).toFixed(1)}MB — the limit is 50MB`);
        return;
      }
      void submit(fd);
    },
    [submit]
  );

  // ---- poll -------------------------------------------------------------
  useEffect(() => {
    if (!jobId) return;
    let dead = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/run/${jobId}`, { cache: "no-store" });
        if (dead) return;
        if (r.status === 404) {
          setErr("job expired — jobs are kept for one hour");
          setJobId(null);
          return;
        }
        const j = (await r.json()) as JobStatus;
        setJob(j);
        if (!dsTab && j.datasets[0]) setDsTab(j.datasets[0].name);
        if (j.status === "done" || j.status === "error") {
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        /* transient — keep polling */
      }
    };
    void tick();
    pollRef.current = window.setInterval(tick, POLL_MS);
    return () => {
      dead = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [jobId, dsTab]);

  // ---- fetch case rows once a dataset finishes --------------------------
  useEffect(() => {
    if (!job) return;
    for (const ds of job.datasets) {
      if (ds.status === "done" && !rows[ds.name]) {
        fetch(`/api/run/${job.id}/cases?ds=${encodeURIComponent(ds.name)}`, {
          cache: "no-store",
        })
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            if (d?.rows) setRows((m) => ({ ...m, [ds.name]: d.rows }));
          })
          .catch(() => {});
      }
    }
  }, [job, rows]);

  // ---- open a case -------------------------------------------------------
  useEffect(() => {
    if (!selected || !job) return;
    setTrace(null);
    fetch(
      `/api/run/${job.id}/trace?ds=${encodeURIComponent(selected.ds)}&case=${encodeURIComponent(selected.caseId)}`,
      { cache: "no-store" }
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((t) => setTrace(t))
      .catch(() => setTrace(null));
  }, [selected, job]);

  const active = useMemo(
    () => job?.datasets.find((d) => d.name === dsTab) ?? job?.datasets[0] ?? null,
    [job, dsTab]
  );

  const filtered = useMemo(() => {
    const all = active ? rows[active.name] ?? [] : [];
    const q = query.trim().toLowerCase();
    return all.filter(
      (r) =>
        (!vFilter || r.verdict === vFilter) &&
        (!q ||
          r.case_id.toLowerCase().includes(q) ||
          r.customer.toLowerCase().includes(q) ||
          r.reason_code.toLowerCase().includes(q) ||
          r.reason.toLowerCase().includes(q) ||
          r.evidence.some((e) => e.toLowerCase().includes(q)))
    );
  }, [active, rows, query, vFilter]);

  const reset = useCallback(() => {
    setJobId(null);
    setJob(null);
    setRows({});
    setSelected(null);
    setTrace(null);
    setErr(null);
    setIssues([]);
  }, []);

  // ---- case view ---------------------------------------------------------
  if (selected && job) {
    return (
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        {trace ? (
          <RunCaseBoard
            trace={trace}
            docUrl={(docId) =>
              `/api/run/${job.id}/doc?ds=${encodeURIComponent(selected.ds)}&doc=${encodeURIComponent(docId)}`
            }
            onBack={() => {
              setSelected(null);
              setTrace(null);
            }}
          />
        ) : (
          <p className="mono p-10 text-[11px] tracking-[0.18em] text-ink-500">
            <span className="cp-dots">[ LOADING CASE {selected.caseId}</span>
            <span> ]</span>
          </p>
        )}
      </div>
    );
  }

  const running = job && (job.status === "queued" || job.status === "running");

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      {/* ============================ upload ============================ */}
      {!job && (
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              onZip(e.dataTransfer.files?.[0]);
            }}
            className={`panel flex min-h-[300px] flex-col items-center justify-center gap-4 border-dashed p-8 text-center transition-colors ${
              drag ? "border-accent bg-accent/5" : ""
            }`}
          >
            <span className="doto text-[26px] leading-tight text-ink-100">
              DROP A .ZIP OF AN
              <br />
              INSTITUTION FOLDER
            </span>
            <p className="max-w-[52ch] text-[12.5px] leading-relaxed text-ink-400">
              The same folder the judges hand over: POLICY.md, cases.jsonl,
              alerts.jsonl, customers.jsonl, transactions.jsonl,
              evidence.jsonl + evidence/, previous_reviews.jsonl,
              internal_list.jsonl — at the zip root or inside one subfolder.
              Several institution folders in one zip run one after another.
              Max 50MB.
            </p>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
              <button className={BTN} disabled={busy} onClick={() => zipRef.current?.click()}>
                CHOOSE .ZIP
              </button>
              <button className={BTN} disabled={busy} onClick={() => folderRef.current?.click()}>
                CHOOSE FOLDER
              </button>
            </div>
            <input
              ref={zipRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => {
                onZip(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <input
              ref={(el) => {
                folderRef.current = el;
                el?.setAttribute("webkitdirectory", "");
              }}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                onFolder(e.target.files);
                e.target.value = "";
              }}
            />
            {busy && (
              <p className="mono text-[10.5px] tracking-[0.16em] text-accent">
                <span className="cp-dots">[ UPLOADING + VALIDATING</span>
                <span> ]</span>
              </p>
            )}
          </div>

          <div className="panel flex flex-col gap-3 p-5">
            <span className="label">No file handy?</span>
            <p className="text-[12.5px] leading-relaxed text-ink-300">
              Run a dev institution from this host — zipped server-side and put
              through the exact same upload pipeline.
            </p>
            <div className="mt-1 grid grid-cols-1 gap-2">
              {(avail?.samples ?? []).map((s) => (
                <button
                  key={s.id}
                  disabled={busy}
                  onClick={() => void submit({ sample: s.id })}
                  className={`${BTN} justify-between gap-3 !px-4`}
                >
                  <span className="text-left">USE SAMPLE · {SAMPLE_LABEL[s.id] ?? s.id.toUpperCase()}</span>
                  <span className="shrink-0 text-ink-500">{s.cases.toLocaleString()} cases</span>
                </button>
              ))}
              {avail && !avail.samples.length && (
                <p className="mono text-[10px] leading-relaxed text-ink-500">
                  [ no dev institutions on this host — upload a zip ]
                </p>
              )}
              {avail === null && (
                <p className="mono text-[10px] text-ink-600">checking host…</p>
              )}
            </div>
            {avail && !avail.engine && (
              <p className="mono rounded border border-escalate/50 bg-escalate/10 px-3 py-2 text-[10px] leading-relaxed text-escalate">
                system/run not found on this host — uploads will fail at run time
              </p>
            )}
            <div className="mt-auto border-t border-line pt-3">
              <p className="mono text-[9.5px] leading-relaxed text-ink-600">
                extracted to a temp dir outside the repo · no path traversal, no
                symlinks · job + files deleted after 1 hour
              </p>
            </div>
          </div>
        </section>
      )}

      {/* ====================== validation errors ======================= */}
      {(err || issues.length > 0) && !job && (
        <div className="panel border-escalate/50 p-5">
          <span className="mono text-[11px] font-bold tracking-[0.14em] text-escalate">
            UPLOAD REJECTED
          </span>
          <p className="mt-2 text-[13px] text-ink-200">{err}</p>
          {issues.length > 0 && (
            <div className="mono mt-3 flex flex-col gap-1 text-[11px] text-ink-300">
              {issues.slice(0, 20).map((i, k) => (
                <span key={k}>
                  {i.dataset ? `[${i.dataset}] ` : ""}
                  <span className="text-escalate">{i.file}</span>
                  {i.line ? ` line ${i.line}` : ""} — {i.message}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =========================== progress =========================== */}
      {job && (
        <section className="panel p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="label">Job {job.id}</span>
            <span className="mono text-[10px] text-ink-500">{job.label}</span>
            <span className="ml-auto flex items-center gap-3">
              {running && (
                <span className="mono text-[10.5px] tracking-[0.14em] text-accent">
                  {job.status === "queued" ? (
                    <>[ QUEUED{job.queue_pos > 1 ? ` · POSITION ${job.queue_pos}` : ""} ]</>
                  ) : (
                    <span className="cp-dots">[ RUNNING</span>
                  )}
                </span>
              )}
              {job.status === "done" && (
                <span className="mono rounded border border-close/50 bg-close/10 px-2 py-0.5 text-[10px] font-bold tracking-[0.12em] text-close">
                  DONE
                </span>
              )}
              {job.status === "error" && (
                <span className="mono rounded border border-escalate/50 bg-escalate/10 px-2 py-0.5 text-[10px] font-bold tracking-[0.12em] text-escalate">
                  ERROR — {job.error}
                </span>
              )}
              <button className={BTN} onClick={reset}>
                NEW RUN
              </button>
            </span>
          </div>
          <div className="mt-4 flex flex-col gap-2.5">
            {job.datasets.map((ds) => (
              <div key={ds.name} className="flex flex-wrap items-center gap-3">
                <span className="mono w-[140px] truncate text-[11px] font-bold text-ink-100">
                  {ds.name}
                </span>
                <span className="mono text-[10px] text-ink-500">
                  {ds.cases.toLocaleString()} cases
                </span>
                <div className="flex flex-1 items-center gap-1.5">
                  {Array.from({ length: ds.runs_total }, (_, i) => i + 1).map((n) => {
                    const rec = ds.runs.find((r) => r.n === n);
                    const cur = ds.status === "running" && ds.current_run === n;
                    return (
                      <span
                        key={n}
                        className={`mono rounded border px-2 py-1 text-[9.5px] tracking-[0.08em] ${
                          rec
                            ? "border-close/50 bg-close/10 text-close"
                            : cur
                              ? "border-accent/60 bg-accent/10 text-accent"
                              : "border-line text-ink-600"
                        }`}
                        title={rec ? `run ${n} finished in ${(rec.ms / 1000).toFixed(1)}s` : `run ${n}`}
                      >
                        {rec ? `✓ ${(rec.ms / 1000).toFixed(1)}s` : cur ? `run ${n}…` : `run ${n}`}
                      </span>
                    );
                  })}
                </div>
                {ds.status === "error" && (
                  <span className="mono text-[10px] text-escalate">{ds.error}</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ==================== per-dataset results ======================= */}
      {job && job.datasets.length > 1 && (
        <div className="flex items-center gap-2">
          {job.datasets.map((d) => (
            <button
              key={d.name}
              onClick={() => setDsTab(d.name)}
              className={`mono rounded-md px-3 py-1.5 text-[10.5px] font-bold tracking-[0.1em] transition-colors ${
                active?.name === d.name
                  ? "bg-ink-100 text-obsidian-950"
                  : "border border-line text-ink-400 hover:text-ink-100"
              }`}
            >
              {d.name.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {job && active && active.status === "done" && (
        <>
          {/* -------- reproducibility proof -------- */}
          <section className="panel p-5">
            <div className="flex flex-wrap items-center gap-4">
              <span className="label">Reproducibility — the judge&apos;s test</span>
              <span className="mono text-[10px] text-ink-500">
                system/run executed {active.runs_total}× from scratch on your upload
              </span>
              <span className="ml-auto">
                {active.identical ? (
                  <span className="doto rounded-md border border-close/60 bg-close/10 px-4 py-1.5 text-[18px] text-close">
                    IDENTICAL ✓
                  </span>
                ) : (
                  <span className="doto rounded-md border border-escalate/60 bg-escalate/10 px-4 py-1.5 text-[18px] text-escalate">
                    DIFFERS ✗
                  </span>
                )}
              </span>
            </div>

            <div className="mono mt-3 text-[10.5px] text-ink-400">
              input (dataset) sha256 —{" "}
              <Hash value={active.input_sha256} label="input sha256" />
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-left">
                <thead>
                  <tr className="mono text-[9.5px] uppercase tracking-[0.12em] text-ink-500">
                    <th className="border-b border-line py-2 pr-4 font-medium">run</th>
                    <th className="border-b border-line py-2 pr-4 font-medium">time</th>
                    <th className="border-b border-line py-2 pr-4 font-medium">output .jsonl sha256</th>
                    <th className="border-b border-line py-2 pr-4 font-medium">traces (reasoning) sha256</th>
                  </tr>
                </thead>
                <tbody>
                  {active.runs.map((r) => (
                    <tr key={r.n}>
                      <td className="mono border-b border-line/60 py-2 pr-4 text-[11px] font-bold text-ink-100">
                        {r.n}/{active.runs_total}
                      </td>
                      <td className="mono border-b border-line/60 py-2 pr-4 text-[11px] text-ink-300">
                        {(r.ms / 1000).toFixed(1)}s
                      </td>
                      <td className="border-b border-line/60 py-2 pr-4">
                        <Hash value={r.output_sha256} label="output sha256" />
                      </td>
                      <td className="border-b border-line/60 py-2 pr-4">
                        <Hash value={r.trace_sha256} label="trace sha256" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {active.first_diff && (
              <div className="mono mt-3 rounded-md border border-escalate/50 bg-escalate/5 p-3 text-[10.5px] leading-relaxed text-ink-300">
                <span className="font-bold text-escalate">
                  first difference — run 1 vs run {active.first_diff.run}, line{" "}
                  {active.first_diff.line}
                </span>
                <div className="mt-2 grid grid-cols-1 gap-2">
                  <div>
                    <span className="text-close">run 1: </span>
                    <span className="break-all">{active.first_diff.a}</span>
                  </div>
                  <div>
                    <span className="text-escalate">run {active.first_diff.run}: </span>
                    <span className="break-all">{active.first_diff.b}</span>
                  </div>
                </div>
              </div>
            )}

            {/* -------- validate.py -------- */}
            {active.validation && (
              <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-line pt-3">
                <span className="label">format check — system/validate.py</span>
                {active.validation.ok ? (
                  <span className="mono rounded border border-close/50 bg-close/10 px-2 py-0.5 text-[10px] font-bold tracking-[0.1em] text-close">
                    0 ERRORS ✓
                  </span>
                ) : (
                  <span className="mono rounded border border-escalate/50 bg-escalate/10 px-2 py-0.5 text-[10px] font-bold tracking-[0.1em] text-escalate">
                    {active.validation.errors.length} ERROR(S)
                  </span>
                )}
                <span className="mono text-[10px] text-ink-500">{active.validation.summary}</span>
                {active.validation.errors.length > 0 && (
                  <div className="mono mt-1 w-full text-[10.5px] text-escalate">
                    {active.validation.errors.slice(0, 12).map((e, i) => (
                      <div key={i}>ERR {e}</div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* -------- downloads -------- */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <span className="label mr-2">Downloads</span>
              <a
                className={BTN}
                href={`/api/run/${job.id}/file?ds=${encodeURIComponent(active.name)}&kind=output`}
                download
              >
                ↓ OUTPUT .JSONL
              </a>
              <a
                className={BTN}
                href={`/api/run/${job.id}/file?ds=${encodeURIComponent(active.name)}&kind=traces`}
                download
              >
                ↓ TRACES .JSONL
              </a>
              <a
                className={BTN}
                href={`/api/run/${job.id}/file?ds=${encodeURIComponent(active.name)}&kind=report`}
                download
              >
                ↓ RUN-REPORT.JSON
              </a>
            </div>
          </section>

          {/* -------- verdict summary -------- */}
          {active.verdict_counts && (
            <section className="panel flex flex-wrap items-stretch gap-0">
              <div className="flex flex-col justify-center gap-1 border-r border-line px-6 py-4">
                <span className="label">Cases triaged</span>
                <span className="doto text-[36px] leading-none text-ink-100">
                  {(rows[active.name]?.length ?? active.cases).toLocaleString("en-GB")}
                </span>
              </div>
              <div className="flex min-w-[280px] flex-1 flex-col justify-center gap-2 border-r border-line px-6 py-4">
                <div className="flex items-baseline justify-between gap-6">
                  {VERDICTS.map((v) => {
                    const n = active.verdict_counts![v];
                    const total =
                      active.verdict_counts!.CLOSE +
                      active.verdict_counts!.RFI +
                      active.verdict_counts!.ESCALATE;
                    return (
                      <div key={v} className="flex items-baseline gap-2">
                        <span className="label">{v}</span>
                        <span className="mono text-[13px] font-bold" style={{ color: VERDICT_COLOR[v] }}>
                          {n.toLocaleString()} · {total ? Math.round((n / total) * 100) : 0}%
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="flex h-[8px] w-full gap-[2px]">
                  {VERDICTS.map((v) => (
                    <div
                      key={v}
                      className="h-full"
                      style={{ flex: `${active.verdict_counts![v]} 1 0`, background: VERDICT_COLOR[v] }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex min-w-[220px] flex-col justify-center gap-1 px-6 py-4">
                <span className="label">Top reason codes</span>
                <div className="mono flex flex-col gap-0.5 text-[10.5px] text-ink-300">
                  {active.top_reason_codes.slice(0, 4).map(([c, n]) => (
                    <span key={c}>
                      <span className="text-accent">{n}</span> {c}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* -------- results table -------- */}
          <section className="panel flex flex-col">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
              <span className="label">Every case — click a row for the full board</span>
              <div className="ml-auto flex items-center gap-2">
                <div className="flex items-center overflow-hidden rounded-md border border-line-2">
                  <button
                    onClick={() => setVFilter(null)}
                    className={`mono px-2.5 py-1.5 text-[9.5px] font-bold tracking-[0.1em] ${
                      vFilter === null ? "bg-ink-100 text-obsidian-950" : "text-ink-500 hover:text-ink-100"
                    }`}
                  >
                    ALL
                  </button>
                  {VERDICTS.map((v) => (
                    <button
                      key={v}
                      onClick={() => setVFilter(vFilter === v ? null : v)}
                      className={`mono px-2.5 py-1.5 text-[9.5px] font-bold tracking-[0.1em] ${
                        vFilter === v ? "bg-ink-100 text-obsidian-950" : "hover:text-ink-100"
                      }`}
                      style={vFilter === v ? undefined : { color: `${VERDICT_COLOR[v]}99` }}
                    >
                      {v}
                    </button>
                  ))}
                </div>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="SEARCH CASES, REASONS, EVIDENCE…"
                  className="mono w-[280px] rounded-md border border-line bg-obsidian-850 px-3 py-2 text-[11px] tracking-wide text-ink-100 outline-none placeholder:text-ink-600 focus:border-accent"
                />
              </div>
            </div>
            <div className="max-h-[560px] overflow-y-auto">
              {!rows[active.name] && (
                <p className="mono px-5 py-10 text-[11px] tracking-[0.18em] text-ink-500">
                  <span className="cp-dots">[ LOADING RESULTS</span>
                  <span> ]</span>
                </p>
              )}
              <table className="w-full border-collapse text-left">
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.case_id}
                      onClick={() => setSelected({ ds: active.name, caseId: r.case_id })}
                      className="group cursor-pointer transition-colors hover:bg-obsidian-800/60"
                    >
                      <td className="w-[170px] border-b border-line/60 px-4 py-2.5">
                        <div className="mono text-[12px] font-bold text-ink-100">{r.case_id}</div>
                        <div className="truncate text-[10.5px] text-ink-500">{r.customer}</div>
                      </td>
                      <td className="w-[150px] border-b border-line/60 px-2 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {r.rules.slice(0, 3).map((rule, i) => (
                            <span
                              key={`${rule}-${i}`}
                              className="mono rounded border border-line bg-obsidian-800 px-1.5 py-0.5 text-[9.5px] text-ink-300"
                              title={r.alert_ids.join(", ")}
                            >
                              {rule}
                            </span>
                          ))}
                          {r.rules.length > 3 && (
                            <span className="mono text-[9.5px] text-ink-600">+{r.rules.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td className="w-[110px] border-b border-line/60 px-2 py-2.5">
                        <VerdictPill verdict={r.verdict} />
                      </td>
                      <td className="w-[190px] border-b border-line/60 px-2 py-2.5">
                        <span className="mono text-[10px] tracking-wide text-accent">{r.reason_code}</span>
                      </td>
                      <td className="border-b border-line/60 px-2 py-2.5">
                        <p className="line-clamp-2 text-[11.5px] leading-snug text-ink-300">{r.reason}</p>
                        <div className="mono mt-1 flex flex-wrap gap-1 text-[9.5px] text-ink-500">
                          {r.evidence.slice(0, 6).map((e) => (
                            <span key={e} className="rounded border border-line bg-obsidian-800 px-1 py-px">
                              {e}
                            </span>
                          ))}
                          {r.evidence.length > 6 && <span>+{r.evidence.length - 6}</span>}
                        </div>
                      </td>
                      <td className="w-[30px] border-b border-line/60 px-2 py-2.5 text-ink-600 transition-colors group-hover:text-accent">
                        →
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows[active.name] && filtered.length === 0 && (
                <p className="mono px-5 py-10 text-[11px] tracking-[0.18em] text-ink-500">
                  [ EMPTY — no cases match ]
                </p>
              )}
            </div>
            <div className="mono border-t border-line px-4 py-2 text-[9.5px] tracking-[0.12em] text-ink-600">
              {filtered.length.toLocaleString()} of {(rows[active.name]?.length ?? 0).toLocaleString()} cases
            </div>
          </section>
        </>
      )}

      {/* -------- CLI box -------- */}
      <section className="panel p-5">
        <span className="label">Prefer the terminal?</span>
        <div className="mono mt-3 flex flex-col gap-1.5 rounded-md border border-line bg-obsidian-900 p-4 text-[11.5px] leading-relaxed text-ink-300">
          <span className="text-ink-500"># run the same engine the judges call — from inside system/</span>
          <span>
            <span className="text-accent">$</span> system/run &lt;institution folder&gt; &lt;output file&gt;
          </span>
          <span>
            <span className="text-accent">$</span> system/run institutions/bank output/bank.jsonl
          </span>
          <span className="mt-2 text-ink-500"># the reproducibility check — 5 runs per institution, diffed</span>
          <span>
            <span className="text-accent">$</span> system/check_repro.sh
          </span>
          <span className="mt-2 text-ink-500"># the official format check</span>
          <span>
            <span className="text-accent">$</span> python3 system/validate.py &lt;folder&gt; &lt;output file&gt;
          </span>
        </div>
        <button
          className={`${BTN} mt-3`}
          onClick={() =>
            navigator.clipboard
              ?.writeText(
                "system/run institutions/bank output/bank.jsonl\nsystem/check_repro.sh\npython3 system/validate.py institutions/bank output/bank.jsonl"
              )
              .catch(() => {})
          }
        >
          COPY COMMANDS
        </button>
      </section>
    </div>
  );
}
