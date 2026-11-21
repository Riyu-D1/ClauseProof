"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import CustomerCard from "@/components/CustomerCard";
import DecisionPath from "@/components/DecisionPath";
import EvidenceDrawer from "@/components/EvidenceDrawer";
import FlipCard from "@/components/FlipCard";
import FlowGraph from "@/components/FlowGraph";
import VerdictPill from "@/components/VerdictPill";
import { INSTITUTION_LABEL, type Trace, type Verdict } from "@/lib/types";

interface Peer {
  case_id: string;
  verdict: Verdict;
  name: string;
}

export default function CaseBoard({ trace, peers }: { trace: Trace; peers: Peer[] }) {
  const router = useRouter();
  const [doc, setDoc] = useState<string | null>(null);
  const [runId, setRunId] = useState(0);
  const idx = useMemo(() => peers.findIndex((p) => p.case_id === trace.case_id), [peers, trace]);
  const prev = idx > 0 ? peers[idx - 1] : null;
  const next = idx >= 0 && idx < peers.length - 1 ? peers[idx + 1] : null;

  const onDoc = useCallback((id: string) => setDoc(id), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        if (doc) setDoc(null);
        else router.push("/");
      } else if (!doc) {
        if (e.key === "j" && next) router.push(`/case/${next.case_id}`);
        else if (e.key === "k" && prev) router.push(`/case/${prev.case_id}`);
        else if (e.key === "r") setRunId((n) => n + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, next, prev, router]);

  return (
    <div className="flex min-h-[calc(100vh-57px)] flex-col gap-3 p-4 xl:h-[calc(100vh-57px)] xl:overflow-hidden">
      {/* header strip */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/")}
          className="mono rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-ink-300 hover:border-[#37e0d855] hover:text-ink-100"
        >
          ← queue
        </button>
        <div className="flex flex-col">
          <div className="flex items-center gap-2.5">
            <span className="mono text-[15px] font-semibold text-ink-100">{trace.case_id}</span>
            <span className="mono rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-ink-400">
              {INSTITUTION_LABEL[trace.institution] ?? trace.institution}
            </span>
            <VerdictPill verdict={trace.verdict} />
          </div>
          <span className="mono mt-0.5 text-[10px] text-ink-600">
            {trace.customer.name} · input {trace.input_hash}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setRunId((n) => n + 1)}
            className="mono rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-ink-300 hover:border-[#37e0d855] hover:text-ink-100"
            title="Replay the decision path"
          >
            ⟳ replay <span className="kbd ml-1">r</span>
          </button>
          <div className="flex items-center gap-1">
            <button
              disabled={!prev}
              onClick={() => prev && router.push(`/case/${prev.case_id}`)}
              className="mono rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-ink-300 hover:border-[#37e0d855] disabled:opacity-30"
              title={prev ? `${prev.case_id} · ${prev.name}` : "first case"}
            >
              ↑ <span className="kbd">k</span>
            </button>
            <button
              disabled={!next}
              onClick={() => next && router.push(`/case/${next.case_id}`)}
              className="mono rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-ink-300 hover:border-[#37e0d855] disabled:opacity-30"
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
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="min-h-0 xl:overflow-y-auto"
        >
          <CustomerCard trace={trace} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.45, delay: 0.08 }}
          className="panel relative min-h-[460px] overflow-hidden xl:min-h-0"
        >
          <FlowGraph trace={trace} onDoc={onDoc} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: 0.16 }}
          className="panel min-h-[400px] overflow-y-auto p-4 xl:min-h-0"
        >
          <DecisionPath trace={trace} runId={runId} onDoc={onDoc} />
        </motion.div>
      </div>

      <FlipCard trace={trace} />

      <EvidenceDrawer institution={trace.institution} docId={doc} onClose={() => setDoc(null)} />
    </div>
  );
}
