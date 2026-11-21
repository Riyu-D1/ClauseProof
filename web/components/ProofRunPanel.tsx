"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { INSTITUTION_LABEL } from "@/lib/types";

interface RunResult {
  n: number;
  ms: number;
  hash: string;
}
type Status = "idle" | "running" | "done" | "error";

const INSTITUTIONS = ["bank", "emoney", "investment", "payments_fx"];

export default function ProofRunPanel() {
  const [inst, setInst] = useState("bank");
  const [status, setStatus] = useState<Status>("idle");
  const [runs, setRuns] = useState<RunResult[]>([]);
  const [identical, setIdentical] = useState<boolean | null>(null);
  const [totalMs, setTotalMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const t0Ref = useRef(0);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (status !== "running") return;
    const t = window.setInterval(
      () => setElapsed(performance.now() - t0Ref.current),
      250
    );
    return () => window.clearInterval(t);
  }, [status]);

  async function start() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus("running");
    setRuns([]);
    setIdentical(null);
    setError(null);
    t0Ref.current = performance.now();
    try {
      const res = await fetch("/api/proof-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ institution: inst }),
        signal: ac.signal,
      });
      if (!res.ok || !res.body) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as {
            type: string;
            n?: number;
            ms?: number;
            hash?: string;
            identical?: boolean;
            total_ms?: number;
            message?: string;
          };
          if (ev.type === "run" && ev.n != null && ev.hash) {
            setRuns((r) => [...r, { n: ev.n!, ms: ev.ms ?? 0, hash: ev.hash! }]);
          } else if (ev.type === "done") {
            setIdentical(!!ev.identical);
            setTotalMs(ev.total_ms ?? Math.round(performance.now() - t0Ref.current));
            setStatus("done");
          } else if (ev.type === "error") {
            throw new Error(ev.message ?? "run failed");
          }
        }
      }
      setStatus((s) => (s === "running" ? "done" : s));
    } catch (e) {
      if (ac.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  const first = runs[0]?.hash;

  return (
    <div className="panel flex flex-col gap-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="label">The 5× proof — run it now</span>
          <p className="mt-1.5 max-w-[560px] text-[12px] leading-relaxed text-ink-400">
            This really runs <code className="mono text-ink-300">system/run</code> five
            times on the full{" "}
            {INSTITUTION_LABEL[inst] ?? inst} dataset into a temp dir and SHA-256s
            each output file — the same rehearsal the judges will do on 800
            unseen cases.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center overflow-hidden rounded-md border border-line-2">
            {INSTITUTIONS.map((i) => (
              <button
                key={i}
                onClick={() => setInst(i)}
                disabled={status === "running"}
                className={`mono px-2.5 py-1.5 text-[9.5px] font-bold tracking-[0.08em] transition-colors disabled:opacity-40 ${
                  inst === i ? "bg-ink-100 text-obsidian-950" : "text-ink-400 hover:text-ink-100"
                }`}
              >
                {(INSTITUTION_LABEL[i] ?? i).toUpperCase()}
              </button>
            ))}
          </div>
          <button
            onClick={() => void start()}
            disabled={status === "running"}
            className="mono rounded-full bg-ink-100 px-4 py-1.5 text-[10.5px] font-bold tracking-[0.1em] text-obsidian-950 transition-opacity hover:opacity-85 disabled:cursor-wait disabled:opacity-50"
          >
            {status === "running"
              ? `RUNNING ${runs.length}/5 — ${(elapsed / 1000).toFixed(0)}s`
              : "RUN 5× NOW"}
          </button>
        </div>
      </div>

      {(status !== "idle" || runs.length > 0) && (
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 5 }, (_, i) => i + 1).map((n) => {
            const r = runs.find((x) => x.n === n);
            return (
              <div
                key={n}
                className="mono flex items-center gap-3 rounded-md border border-line bg-obsidian-900 px-3 py-2 text-[10.5px]"
              >
                <span className="w-10 text-ink-500">run {n}</span>
                {r ? (
                  <>
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="min-w-0 flex-1 truncate text-ink-100"
                      title={r.hash}
                    >
                      {r.hash}
                    </motion.span>
                    <span className="shrink-0 text-ink-500">{(r.ms / 1000).toFixed(1)}s</span>
                    {first && (
                      <span
                        className="shrink-0 font-bold"
                        style={{ color: r.hash === first ? "#38d07d" : "#ff5566" }}
                        title={r.hash === first ? "identical to run 1" : "differs from run 1"}
                      >
                        {r.hash === first ? "✓" : "✗"}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="flex-1 text-ink-600">
                    {status === "running" && n === runs.length + 1 ? (
                      <span className="cp-dots">system/run executing</span>
                    ) : (
                      "queued"
                    )}
                  </span>
                )}
              </div>
            );
          })}
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <span className="mono text-[9.5px] leading-relaxed tracking-[0.04em] text-ink-500">
              {status === "running" &&
                "each row is the SHA-256 fingerprint of one complete output file, produced in order"}
              {status === "done" &&
                `${(totalMs / 1000).toFixed(1)}s total · ${new Set(runs.map((r) => r.hash)).size} unique fingerprint${runs.length > 1 ? "s" : ""} across ${runs.length} full runs`}
              {status === "error" && <span className="text-escalate">{error}</span>}
            </span>
            {status === "done" && identical != null && (
              <span
                className="mono rounded border px-2 py-0.5 text-[9.5px] font-bold tracking-[0.1em]"
                style={{
                  color: identical ? "#38d07d" : "#ff5566",
                  borderColor: identical ? "#38d07d55" : "#ff556655",
                }}
              >
                {identical ? "BYTE-IDENTICAL 5/5" : "OUTPUTS DIFFER — WOULD FAIL"}
              </span>
            )}
          </div>
        </div>
      )}

      {status === "idle" && (
        <p className="mono text-[10px] tracking-[0.06em] text-ink-600">
          [ NOT RUN YET THIS SESSION — the stored result from check_repro.sh is shown below ]
        </p>
      )}
    </div>
  );
}
