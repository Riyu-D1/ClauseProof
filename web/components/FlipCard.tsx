"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import VerdictPill from "@/components/VerdictPill";
import type { Trace } from "@/lib/types";

export default function FlipCard({ trace }: { trace: Trace }) {
  const [flipped, setFlipped] = useState(false);
  const flip = trace.flip;
  return (
    <div className="panel flex items-center gap-4 px-4 py-3">
      <div className="flex flex-col">
        <span className="mono text-[9.5px] tracking-[0.18em] text-ink-500">WHAT WOULD FLIP IT</span>
        {flip ? (
          <span className="mt-0.5 text-[12.5px] text-ink-100">
            {flip.change}
            <span className="mono ml-2 text-[10px] text-ink-500">→ {flip.new_verdict}</span>
          </span>
        ) : (
          <span className="mt-0.5 text-[12.5px] text-ink-300">
            No single change flips this verdict — once there is suspicion the case goes to the
            MLRO.
          </span>
        )}
      </div>
      {flip && (
        <div className="ml-auto flex items-center gap-3">
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
            onClick={() => setFlipped((f) => !f)}
            role="switch"
            aria-checked={flipped}
            className={`relative h-5 w-10 rounded-full border transition-colors ${
              flipped ? "border-[#37e0d866] bg-[#37e0d822]" : "border-white/15 bg-white/[0.05]"
            }`}
            title="Simulate the flip"
          >
            <motion.span
              layout
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
              className={`absolute top-[2px] h-3.5 w-3.5 rounded-full ${
                flipped ? "right-[2px] bg-accent" : "left-[2px] bg-ink-500"
              }`}
            />
          </button>
        </div>
      )}
    </div>
  );
}
