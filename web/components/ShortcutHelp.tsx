"use client";

import { AnimatePresence, motion } from "framer-motion";

const GROUPS: { title: string; keys: [string, string][] }[] = [
  {
    title: "Go to",
    keys: [
      ["g o", "overview"],
      ["g q", "alert queue"],
      ["g l", "try it live"],
      ["g s", "beat the analyst"],
      ["g p", "proof"],
    ],
  },
  {
    title: "Queue",
    keys: [
      ["j / k", "move down / up"],
      ["enter", "open case"],
      ["1–9", "open demo pick"],
      ["/", "focus search"],
    ],
  },
  {
    title: "Case board",
    keys: [
      ["j / k", "next / previous case"],
      ["d", "decide live — engine run now"],
      ["r", "replay decision path"],
      ["f", "toggle flip simulation"],
      ["o", "OSINT drawer"],
      ["esc", "close panel / back"],
    ],
  },
  {
    title: "General",
    keys: [["?", "this sheet"]],
  },
];

export default function ShortcutHelp({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/60"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.18 }}
            className="fixed left-1/2 top-1/2 z-[70] w-[560px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line-2 bg-obsidian-900 p-6"
            role="dialog"
            aria-label="Keyboard shortcuts"
          >
            <div className="mb-5 flex items-center justify-between">
              <span className="label">Keyboard shortcuts</span>
              <button
                onClick={onClose}
                className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-400 transition-colors hover:border-line-2 hover:text-ink-100"
              >
                ✕
              </button>
            </div>
            <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
              {GROUPS.map((g) => (
                <div key={g.title}>
                  <p className="label mb-2.5" style={{ fontSize: "9.5px" }}>
                    {g.title}
                  </p>
                  <ul className="flex flex-col gap-2">
                    {g.keys.map(([k, d]) => (
                      <li key={k} className="flex items-center justify-between gap-3">
                        <span className="text-[11.5px] text-ink-300">{d}</span>
                        <span className="kbd">{k}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
