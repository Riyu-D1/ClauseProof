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
  const [dataset, setDataset] = useState<string | null>(null);
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
            dataset?: string;
            message?: string;
          };
          if (ev.type === "start" && ev.dataset) {
            setDataset(ev.dataset);
          } else if (ev.type === "run" && ev.n != null && ev.hash) {
            setRuns((r) => [...r, { n: ev.n!, ms: ev.ms ?? 0, hash: ev.hash! }]);
          } else if (ev.type === "done") {
            setIdentical(!!ev.identical);
            setTotalMs(ev.total_ms ?? Math.round(performance.now() - t0));
            if (ev.dataset) setDataset(ev.dataset);
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
    <div ref={wrapRef} className="relative flex flex-1 flex-col justify-center px-6 py-4">
      <span className="label">Live proof</span>
      <div className="mt-1.5 flex items-center gap-2.5">
        {/* the one primary action on the screen — white pill, Nothing spec */}
        <button
          onClick={start}
          disabled={status === "running"}
          className="mono rounded-full bg-ink-100 px-4 py-1.5 text-[10.5px] font-bold tracking-[0.1em] text-obsidian-950 transition-opacity hover:opacity-85 disabled:cursor-wait disabled:opacity-50"
          title={`Run system/run 5× on ${INSTITUTION_LABEL[institution] ?? institution} and SHA-256 each output`}
        >
          {status === "running" ? `RUNNING ${runs.length}/5` : "RUN 5×"}
        </button>
        {identical === true && (
          <span className="mono rounded border border-[#38d07d55] bg-[#38d07d10] px-2 py-1 text-[9.5px] font-bold tracking-[0.1em] text-close">
            IDENTICAL 5/5
          </span>
        )}
        {identical === false && (
          <span className="mono rounded border border-[#ff556655] bg-[#ff556610] px-2 py-1 text-[9.5px] font-bold tracking-[0.1em] text-escalate">
            OUTPUTS DIFFER
          </span>
        )}
      </div>

      <AnimatePresence>
        {open && (status !== "idle" || runs.length > 0) && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
            className="absolute right-3 top-full z-50 mt-2 w-[440px] max-w-[92vw] rounded-lg border border-line-2 bg-obsidian-900 p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="label">
                Reproducibility proof · {INSTITUTION_LABEL[institution] ?? institution} · 5 runs
                {dataset === "demo-subset" && " · demo subset"}
              </span>
              <button
                onClick={() => setOpen(false)}
                className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-400 transition-colors hover:border-line-2 hover:text-ink-100"
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
                    className="mono flex items-center gap-2.5 rounded-md border border-line bg-obsidian-850 px-3 py-2 text-[11px]"
                  >
                    <span className="w-8 text-ink-500">#{n}</span>
                    {r ? (
                      <>
                        <motion.span
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="flex-1 text-ink-100"
                          title={r.hash}
                        >
                          {shortHash(r.hash)}
                        </motion.span>
                        <span className="text-ink-500">{(r.ms / 1000).toFixed(1)}s</span>
                        {first && (
                          <span
                            className="font-bold"
                            style={{ color: r.hash === first ? "#38d07d" : "#ff5566" }}
                          >
                            {r.hash === first ? "✓" : "✗"}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="flex-1 text-ink-500">
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
              <span className="mono text-[9.5px] tracking-[0.06em] text-ink-500">
                {status === "running" && "system/run × 5 → sha256 per output"}
                {status === "done" &&
                  `${(totalMs / 1000).toFixed(1)}s total · byte-identical outputs = deterministic verdicts${dataset === "demo-subset" ? " · live run on bundled demo subset" : ""}`}
                {status === "error" && <span className="text-escalate">{error}</span>}
              </span>
              {status === "done" && (
                <span
                  className="mono rounded border px-2 py-0.5 text-[9.5px] font-bold tracking-[0.1em]"
                  style={{
                    color: identical ? "#38d07d" : "#ff5566",
                    borderColor: identical ? "#38d07d55" : "#ff556655",
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
