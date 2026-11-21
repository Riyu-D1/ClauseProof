"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import CustomerCard from "@/components/CustomerCard";
import DecisionPath from "@/components/DecisionPath";
import EvidenceDrawer from "@/components/EvidenceDrawer";
import FlipCard from "@/components/FlipCard";
import FlowGraph from "@/components/FlowGraph";
import ShortcutHelp from "@/components/ShortcutHelp";
import OsintPanel from "@/components/OsintPanel";
import { VERDICT_COLOR } from "@/lib/format";
import { INSTITUTION_LABEL, type Trace, type Verdict } from "@/lib/types";

interface Peer {
  case_id: string;
  verdict: Verdict;
  name: string;
}

const BTN =
  "mono flex h-8 items-center rounded-md border border-line px-3 text-[10.5px] tracking-[0.1em] text-ink-300 transition-colors hover:border-line-2 hover:text-ink-100 disabled:opacity-30";

export default function CaseBoard({ trace, peers }: { trace: Trace; peers: Peer[] }) {
  const router = useRouter();
  const [doc, setDoc] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [help, setHelp] = useState(false);
  const idx = useMemo(() => peers.findIndex((p) => p.case_id === trace.case_id), [peers, trace]);
  const prev = idx > 0 ? peers[idx - 1] : null;
  const next = idx >= 0 && idx < peers.length - 1 ? peers[idx + 1] : null;

  const onDoc = useCallback((id: string) => setDoc(id), []);
  const toggleFlip = useCallback(() => setFlipped((f) => !f), []);

  useEffect(() => setFlipped(false), [trace.case_id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "?") {
        setHelp((h) => !h);
        return;
      }
      if (help) {
        if (e.key === "Escape") setHelp(false);
        return;
      }
      if (e.key === "Escape") {
        if (doc) setDoc(null);
        else router.push("/");
      } else if (!doc) {
        if (e.key === "j" && next) router.push(`/case/${next.case_id}`);
        else if (e.key === "k" && prev) router.push(`/case/${prev.case_id}`);
        else if (e.key === "r") setRunId((n) => n + 1);
        else if (e.key === "f" && trace.flip) toggleFlip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, next, prev, router, trace.flip, toggleFlip, help]);

  const vc = VERDICT_COLOR[trace.verdict];

  return (
    <div className="flex min-h-[calc(100vh-56px)] flex-col gap-3 p-4 xl:h-[calc(100vh-56px)] xl:overflow-hidden">
      {/* header strip — case id + verdict are the primary layer */}
      <div className="flex items-center gap-4">
        <button onClick={() => router.push("/")} className={BTN}>
          ← QUEUE
        </button>
        <div className="flex flex-col">
          <div className="flex items-center gap-3">
            <span className="doto text-[22px] leading-none text-ink-100">{trace.case_id}</span>
            <span className="mono rounded border border-line bg-obsidian-800 px-1.5 py-0.5 text-[9.5px] tracking-[0.12em] text-ink-400">
              {(INSTITUTION_LABEL[trace.institution] ?? trace.institution).toUpperCase()}
            </span>
            <span
              className="doto text-[22px] leading-none"
              style={{ color: vc }}
            >
              {trace.verdict}
            </span>
          </div>
          <span className="mono mt-1.5 text-[10px] tracking-[0.08em] text-ink-500">
            {trace.customer.name} · input {trace.input_hash}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <OsintPanel trace={trace} />
          <button
            onClick={() => setRunId((n) => n + 1)}
            className={BTN}
            title="Replay the decision path"
          >
            ⟳ REPLAY <span className="kbd ml-1">r</span>
          </button>
          <div className="flex items-center gap-1">
            <button
              disabled={!prev}
              onClick={() => prev && router.push(`/case/${prev.case_id}`)}
              className={BTN}
              title={prev ? `${prev.case_id} · ${prev.name}` : "first case"}
            >
              ↑ <span className="kbd">k</span>
            </button>
            <button
              disabled={!next}
              onClick={() => next && router.push(`/case/${next.case_id}`)}
              className={BTN}
              title={next ? `${next.case_id} · ${next.name}` : "last case"}
            >
              ↓ <span className="kbd">j</span>
            </button>
          </div>
        </div>
      </div>

      {/* main board */}
      <div className="grid flex-1 grid-cols-1 gap-3 xl:min-h-0 xl:grid-cols-[290px_minmax(0,1fr)_360px]">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="min-h-0 xl:overflow-y-auto"
        >
          <CustomerCard trace={trace} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.08 }}
          className="panel relative min-h-[460px] overflow-hidden xl:min-h-0"
        >
          <FlowGraph trace={trace} onDoc={onDoc} flipped={flipped} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.16 }}
          className="panel min-h-[400px] overflow-y-auto p-4 xl:min-h-0"
        >
          <DecisionPath trace={trace} runId={runId} onDoc={onDoc} />
        </motion.div>
      </div>

      <FlipCard trace={trace} flipped={flipped} onToggle={toggleFlip} />

      <EvidenceDrawer institution={trace.institution} docId={doc} onClose={() => setDoc(null)} />
      <ShortcutHelp open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
