"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { INSTITUTION_LABEL } from "@/lib/types";

interface RunResult {
  n: number;
  ms: number;
  hash: string;
}
type Status = "idle" | "running" | "done" | "error";

const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

export default function RunProof({ institution }: { institution: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [runs, setRuns] = useState<RunResult[]>([]);
  const [identical, setIdentical] = useState<boolean | null>(null);
  const [totalMs, setTotalMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // close the popover on outside click
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  async function start() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setOpen(true);
    setStatus("running");
    setRuns([]);
    setIdentical(null);
    setError(null);
    const t0 = performance.now();
    try {
      const res = await fetch("/api/proof-run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ institution }),
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
            setTotalMs(ev.total_ms ?? Math.round(performance.now() - t0));
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
    <div ref={wrapRef} className="relative flex flex-1 flex-col justify-center px-5 py-2">
      <span className="mono text-[10px] tracking-[0.16em] text-ink-500">LIVE PROOF</span>
      <div className="mt-0.5 flex items-center gap-2">
        <button
          onClick={start}
          disabled={status === "running"}
          className="mono rounded-lg border border-[#37e0d855] bg-[#37e0d812] px-3 py-1.5 text-[11px] font-semibold text-accent transition-colors hover:bg-[#37e0d820] disabled:cursor-wait disabled:opacity-60"
          title={`Run system/run 5× on ${INSTITUTION_LABEL[institution] ?? institution} and SHA-256 each output`}
        >
          {status === "running" ? `RUNNING ${runs.length}/5…` : "▶ RUN 5×"}
        </button>
        {identical === true && (
          <span className="mono rounded-md border border-[#2bd47d55] bg-[#2bd47d12] px-2 py-1 text-[10px] font-bold text-close">
            IDENTICAL 5/5
          </span>
        )}
        {identical === false && (
          <span className="mono rounded-md border border-[#ff3b5c55] bg-[#ff3b5c12] px-2 py-1 text-[10px] font-bold text-escalate">
            OUTPUTS DIFFER
          </span>
        )}
      </div>

      <AnimatePresence>
        {open && (status !== "idle" || runs.length > 0) && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="panel absolute right-2 top-full z-50 mt-2 w-[440px] max-w-[92vw] p-4 shadow-2xl shadow-black/60"
            style={{ background: "rgba(10,13,18,0.97)" }}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="mono text-[10px] tracking-[0.18em] text-ink-500">
                REPRODUCIBILITY PROOF · {INSTITUTION_LABEL[institution] ?? institution} · 5 RUNS
              </span>
              <button
                onClick={() => setOpen(false)}
                className="mono rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-ink-400 hover:border-white/30"
              >
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: 5 }, (_, i) => i + 1).map((n) => {
                const r = runs.find((x) => x.n === n);
                return (
                  <div
                    key={n}
                    className="mono flex items-center gap-2.5 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2 text-[11px]"
                  >
                    <span className="w-8 text-ink-500">#{n}</span>
                    {r ? (
                      <>
                        <motion.span
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="flex-1 text-ink-100"
                          title={r.hash}
                        >
                          {shortHash(r.hash)}
                        </motion.span>
                        <span className="text-ink-500">{(r.ms / 1000).toFixed(1)}s</span>
                        {first && (
                          <span
                            className="font-bold"
                            style={{ color: r.hash === first ? "#2bd47d" : "#ff3b5c" }}
                          >
                            {r.hash === first ? "✓" : "✗"}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="flex-1 text-ink-600">
                        {status === "running" && n === runs.length + 1 ? (
                          <span className="cp-dots">running</span>
                        ) : (
                          "queued"
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="mono text-[10px] text-ink-500">
                {status === "running" && "system/run × 5 → sha256 per output…"}
                {status === "done" &&
                  `${(totalMs / 1000).toFixed(1)}s total · byte-identical outputs mean deterministic verdicts`}
                {status === "error" && <span className="text-escalate">{error}</span>}
              </span>
              {status === "done" && (
                <span
                  className="mono rounded px-2 py-0.5 text-[10px] font-bold"
                  style={{
                    color: identical ? "#2bd47d" : "#ff3b5c",
                    border: `1px solid ${identical ? "#2bd47d55" : "#ff3b5c55"}`,
                  }}
                >
                  {identical ? "IDENTICAL 5/5" : "NOT IDENTICAL"}
                </span>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
