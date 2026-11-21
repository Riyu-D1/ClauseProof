"use client";

import { AnimatePresence, motion } from "framer-motion";

const QUEUE_KEYS: [string, string][] = [
  ["j / k", "move through the list"],
  ["↵", "open the selected case"],
  ["/", "search cases, customers, counterparties"],
  ["1 – 5", "switch tab (Demo, then institutions)"],
  ["?", "this panel"],
];

const CASE_KEYS: [string, string][] = [
  ["j / k", "next / previous case in the queue"],
  ["r", "replay the decision path"],
  ["f", "toggle the flip simulation"],
  ["esc", "close drawer, then back to queue"],
  ["?", "this panel"],
];

export default function ShortcutHelp({
  open,
  onClose,
  page,
}: {
  open: boolean;
  onClose: () => void;
  page: "queue" | "case";
}) {
  const keys = page === "queue" ? QUEUE_KEYS : CASE_KEYS;
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px]"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.94, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.94, y: 10 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className="panel w-[340px] p-5"
            style={{ background: "rgba(13,17,24,0.97)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mono mb-3 text-[10px] tracking-[0.2em] text-ink-500">
              KEYBOARD SHORTCUTS
            </div>
            <div className="flex flex-col gap-2">
              {keys.map(([k, d]) => (
                <div key={k} className="flex items-center justify-between gap-4">
                  <span className="text-[12px] text-ink-300">{d}</span>
                  <span className="kbd shrink-0">{k}</span>
                </div>
              ))}
            </div>
            <div className="mono mt-4 border-t border-white/[0.07] pt-3 text-[10px] text-ink-600">
              esc or click outside to close
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
