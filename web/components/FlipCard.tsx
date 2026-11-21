"use client";

import { AnimatePresence, motion } from "framer-motion";
import VerdictPill from "@/components/VerdictPill";
import type { Trace, Verdict } from "@/lib/types";

const NULL_COPY: Record<Verdict, { title: string; body: string }> = {
  ESCALATE: {
    title: "Suspicion found — no single change flips this",
    body: "Policy requires escalation: once there is suspicion the case goes to the MLRO, and no single document would change that.",
  },
  CLOSE: {
    title: "Fully explained — no single change flips this",
    body: "The evidence covers the flagged activity and the rest of the file is consistent. Removing one document would not reopen the case.",
  },
  RFI: {
    title: "One answer settles it — no alternative flips this",
    body: "Nothing on file resolves the open point, and nothing looks criminal. Only the document or answer the RFI asks for moves this case.",
  },
};

export default function FlipCard({
  trace,
  flipped,
  onToggle,
}: {
  trace: Trace;
  flipped: boolean;
  onToggle: () => void;
}) {
  const flip = trace.flip;
  const copy = NULL_COPY[trace.verdict];
  return (
    <div className="panel flex items-center gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <span className="mono text-[9.5px] tracking-[0.18em] text-ink-500">
          WHAT WOULD FLIP IT
        </span>
        {flip ? (
          <span className="mt-0.5 truncate text-[12.5px] text-ink-100" title={flip.change}>
            {flip.change}
            <span className="mono ml-2 text-[10px] text-ink-500">→ {flip.new_verdict}</span>
          </span>
        ) : (
          <span className="mt-0.5 text-[12.5px] text-ink-300">
            <span className="font-medium text-ink-100">{copy.title}.</span>{" "}
            <span className="text-ink-400">{copy.body}</span>
          </span>
        )}
      </div>
      {flip && (
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <AnimatePresence mode="wait">
            <motion.div
              key={flipped ? flip.new_verdict : trace.verdict}
              initial={{ rotateX: 90, opacity: 0 }}
              animate={{ rotateX: 0, opacity: 1 }}
              exit={{ rotateX: -90, opacity: 0 }}
              transition={{ duration: 0.28 }}
            >
              <VerdictPill verdict={flipped ? flip.new_verdict : trace.verdict} />
            </motion.div>
          </AnimatePresence>
          <button
            onClick={onToggle}
            role="switch"
            aria-checked={flipped}
            className={`relative h-5 w-10 rounded-full border transition-colors ${
              flipped ? "border-[#37e0d866] bg-[#37e0d822]" : "border-white/15 bg-white/[0.05]"
            }`}
            title="Simulate the flip — affected money flows recolour (f)"
          >
            <motion.span
              layout
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
              className={`absolute top-[2px] h-3.5 w-3.5 rounded-full ${
                flipped ? "right-[2px] bg-accent" : "left-[2px] bg-ink-500"
              }`}
            />
          </button>
          <span className="kbd">f</span>
        </div>
      )}
    </div>
  );
}
