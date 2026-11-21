"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import VerdictPill from "@/components/VerdictPill";
import { VERDICT_COLOR } from "@/lib/format";
import type { Trace } from "@/lib/types";

const RESULT_STYLE: Record<string, { c: string; label: string }> = {
  PASS: { c: "#2bd47d", label: "PASS" },
  FAIL: { c: "#ff3b5c", label: "FAIL" },
  UNKNOWN: { c: "#ffb020", label: "UNKNOWN" },
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
  const [shown, setShown] = useState(0);

  useEffect(() => {
    setShown(0);
    const timers = steps.map((_, i) =>
      setTimeout(() => setShown(i + 1), 350 + i * 520)
    );
    const verdictTimer = setTimeout(() => setShown(steps.length + 1), 350 + steps.length * 520 + 250);
    return () => [...timers, verdictTimer].forEach(clearTimeout);
  }, [runId, steps]);

  const verdictShown = shown > steps.length;
  const c = VERDICT_COLOR[trace.verdict];

  return (
    <div className="flex h-full flex-col">
      <div className="mono mb-3 flex items-center justify-between text-[10px] tracking-[0.18em] text-ink-500">
        <span>DECISION PATH</span>
        <span className="text-ink-600">{trace.engine_version}</span>
      </div>

      <div className="relative flex-1 overflow-y-auto pr-1">
        {/* spine */}
        <div className="absolute bottom-2 left-[13px] top-2 w-px bg-white/[0.07]" />
        <div className="flex flex-col gap-3">
          {steps.map((s, i) => {
            const visible = i < shown;
            const st = RESULT_STYLE[s.result];
            return (
              <AnimatePresence key={`${runId}-${s.step}`}>
                {visible && (
                  <motion.div
                    initial={{ opacity: 0, x: 14 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3 }}
                    className="relative pl-9"
                  >
                    <span
                      className="mono absolute left-0 top-1 flex h-[27px] w-[27px] items-center justify-center rounded-full border text-[10px]"
                      style={{
                        borderColor: `${st.c}55`,
                        color: st.c,
                        background: "#0d1118",
                        boxShadow: `0 0 12px ${st.c}25`,
                      }}
                    >
                      {s.step}
                    </span>
                    <div className="panel p-3">
                      <p className="mono text-[10px] italic leading-snug text-accent/80">
                        “{s.policy_clause}”
                      </p>
                      <p className="mt-1.5 text-[12.5px] leading-snug text-ink-100">
                        {s.question}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span
                          className="mono rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wider"
                          style={{ color: st.c, background: `${st.c}15`, border: `1px solid ${st.c}44` }}
                        >
                          {st.label}
                        </span>
                        {s.evidence.map((e) => (
                          <button
                            key={e}
                            onClick={() => onDoc(e)}
                            className="edge-chip"
                            style={{
                              background: "#0d1118",
                              color: "#37e0d8",
                              border: "1px solid #37e0d840",
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

          {/* verdict lands */}
          <AnimatePresence>
            {verdictShown && (
              <motion.div
                key={`verdict-${runId}`}
                initial={{ opacity: 0, scale: 0.92, y: 16 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 24 }}
                className="relative pl-9"
              >
                <span
                  className="absolute left-0 top-1 flex h-[27px] w-[27px] items-center justify-center rounded-full text-[12px]"
                  style={{ background: `${c}22`, border: `1px solid ${c}66`, color: c }}
                >
                  ◆
                </span>
                <div
                  className="rounded-[14px] border p-3.5"
                  style={{
                    borderColor: `${c}50`,
                    background: `linear-gradient(180deg, ${c}10, ${c}05)`,
                    boxShadow: `0 0 30px ${c}18`,
                  }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <VerdictPill verdict={trace.verdict} size="lg" />
                    <span className="mono rounded-md border border-white/10 bg-black/30 px-1.5 py-0.5 text-[9.5px] text-ink-300">
                      {trace.reason_code}
                    </span>
                  </div>
                  <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-100">
                    {trace.reason}
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {trace.evidence.map((e) => (
                      <button
                        key={e}
                        onClick={() => onDoc(e)}
                        className="edge-chip"
                        style={{
                          background: "rgba(0,0,0,0.35)",
                          color: "#37e0d8",
                          border: "1px solid #37e0d840",
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
