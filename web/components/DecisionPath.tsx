"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { VERDICT_COLOR } from "@/lib/format";
import type { Trace } from "@/lib/types";

const RESULT_STYLE: Record<string, { c: string; label: string }> = {
  PASS: { c: "#38d07d", label: "PASS" },
  FAIL: { c: "#ff5566", label: "FAIL" },
  UNKNOWN: { c: "#ffb224", label: "UNKNOWN" },
};

export default function DecisionPath({
  trace,
  runId,
  onDoc,
}: {
  trace: Trace;
  runId: number;
  onDoc: (id: string) => void;
}) {
  const steps = trace.checks;
  const reduceMotion = useReducedMotion();
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (reduceMotion) {
      setShown(steps.length + 1);
      return;
    }
    setShown(0);
    const timers = steps.map((_, i) =>
      setTimeout(() => setShown(i + 1), 350 + i * 520)
    );
    const verdictTimer = setTimeout(() => setShown(steps.length + 1), 350 + steps.length * 520 + 250);
    return () => [...timers, verdictTimer].forEach(clearTimeout);
  }, [runId, steps, reduceMotion]);

  const verdictShown = shown > steps.length;
  const c = VERDICT_COLOR[trace.verdict];
  const scrollRef = useRef<HTMLDivElement>(null);

  // keep the newest step in view as the path reveals
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [shown, reduceMotion]);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <span className="label">Decision path</span>
        <span className="mono text-[9.5px] text-ink-500">{trace.engine_version}</span>
      </div>

      <div ref={scrollRef} className="relative flex-1 overflow-y-auto pr-1">
        {/* spine */}
        <div className="absolute bottom-2 left-[13px] top-2 w-px bg-line" />
        <div className="flex flex-col gap-3">
          {steps.map((s, i) => {
            const visible = i < shown;
            const st = RESULT_STYLE[s.result];
            return (
              <AnimatePresence key={`${runId}-${s.step}`}>
                {visible && (
                  <motion.div
                    initial={{ opacity: 0, x: 12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.25 }}
                    className="relative pl-10"
                  >
                    {/* square instrument node — number + status colour */}
                    <span
                      className="mono absolute left-0 top-1 flex h-[27px] w-[27px] items-center justify-center rounded-[5px] border text-[10px] font-bold"
                      style={{
                        borderColor: `${st.c}66`,
                        color: st.c,
                        background: "var(--color-obsidian-900)",
                      }}
                    >
                      {s.step}
                    </span>
                    <div className="rounded-lg border border-line bg-obsidian-900 p-3.5">
                      <p className="mono text-[10px] italic leading-snug text-ink-400">
                        “{s.policy_clause}”
                      </p>
                      <p className="mt-1.5 text-[12.5px] leading-snug text-ink-100">
                        {s.question}
                      </p>
                      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                        <span
                          className="mono rounded border px-1.5 py-0.5 text-[9.5px] font-bold tracking-[0.12em]"
                          style={{ color: st.c, borderColor: `${st.c}55`, background: `${st.c}10` }}
                        >
                          {st.label}
                        </span>
                        {s.evidence.map((e) => (
                          <button
                            key={e}
                            onClick={() => onDoc(e)}
                            className="edge-chip"
                            style={{
                              background: "var(--color-obsidian-800)",
                              color: "var(--color-accent)",
                              border: "1px solid rgba(65,216,207,0.3)",
                            }}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            );
          })}

          {/* verdict lands — the primary readout */}
          <AnimatePresence>
            {verdictShown && (
              <motion.div
                key={`verdict-${runId}`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="relative pl-10"
              >
                <span
                  className="absolute left-0 top-1 flex h-[27px] w-[27px] items-center justify-center rounded-[5px] text-[12px]"
                  style={{ background: `${c}18`, border: `1px solid ${c}66`, color: c }}
                >
                  ◆
                </span>
                <div
                  className="rounded-lg border p-4"
                  style={{ borderColor: `${c}55`, background: `${c}08` }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="doto text-[22px] leading-none" style={{ color: c }}>
                      {trace.verdict}
                    </span>
                    <span className="mono rounded border border-line bg-obsidian-900 px-1.5 py-0.5 text-[9.5px] tracking-[0.08em] text-ink-300">
                      {trace.reason_code}
                    </span>
                  </div>
                  <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-100">
                    {trace.reason}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {trace.evidence.map((e) => (
                      <button
                        key={e}
                        onClick={() => onDoc(e)}
                        className="edge-chip"
                        style={{
                          background: "var(--color-obsidian-800)",
                          color: "var(--color-accent)",
                          border: "1px solid rgba(65,216,207,0.3)",
                        }}
                      >
                        ⌕ {e}
                      </button>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
