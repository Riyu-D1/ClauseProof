"use client";

// The same case board the queue uses — money-flow, decision path, flip —
// driven by the uploaded run's trace instead of the precomputed dataset.
// Pure composition of the shared components; nothing here is forked.

import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import CustomerCard from "@/components/CustomerCard";
import DecisionPath from "@/components/DecisionPath";
import EvidenceDrawer from "@/components/EvidenceDrawer";
import FlipCard from "@/components/FlipCard";
import FlowGraph from "@/components/FlowGraph";
import { VERDICT_COLOR } from "@/lib/format";
import type { Trace, TxListing } from "@/lib/types";

const BTN =
  "mono flex h-8 items-center rounded-md border border-line px-3 text-[10.5px] tracking-[0.1em] text-ink-300 transition-colors hover:border-line-2 hover:text-ink-100";

export default function RunCaseBoard({
  trace,
  docUrl,
  onBack,
}: {
  trace: Trace;
  /** fetch URL builder for this job's uploaded evidence docs */
  docUrl: (docId: string) => string;
  onBack: () => void;
}) {
  const [doc, setDoc] = useState<string | null>(null);
  const [txList, setTxList] = useState<TxListing | null>(null);
  const [runId, setRunId] = useState(0);
  const [flipped, setFlipped] = useState(false);

  const onDoc = useCallback((id: string) => setDoc(id), []);
  const onList = useCallback(
    (l: TxListing) =>
      setTxList({ ...l, heldId: trace.customer.held_payment_id }),
    [trace.customer.held_payment_id]
  );
  const closeTop = useCallback(() => {
    if (doc) setDoc(null);
    else setTxList(null);
  }, [doc]);
  const toggleFlip = useCallback(() => setFlipped((f) => !f), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") {
        if (doc) setDoc(null);
        else if (txList) setTxList(null);
        else onBack();
      } else if (!doc) {
        if (e.key === "r") setRunId((n) => n + 1);
        else if (e.key === "f" && trace.flip) toggleFlip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, txList, onBack, trace.flip, toggleFlip]);

  const vc = VERDICT_COLOR[trace.verdict];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <button onClick={onBack} className={BTN}>
          ← RESULTS
        </button>
        <div className="flex flex-col">
          <div className="flex flex-wrap items-center gap-3">
            <span className="doto text-[22px] leading-none text-ink-100">{trace.case_id}</span>
            <span className="mono rounded border border-line bg-obsidian-800 px-1.5 py-0.5 text-[9.5px] tracking-[0.12em] text-ink-400">
              {trace.institution.toUpperCase()}
            </span>
            <span className="doto text-[22px] leading-none" style={{ color: vc }}>
              {trace.verdict}
            </span>
          </div>
          <span className="mono mt-1.5 text-[10px] tracking-[0.08em] text-ink-500">
            {trace.customer.name} · input {trace.input_hash.slice(0, 12)}… · decided by
            this upload&apos;s run 1
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setRunId((n) => n + 1)}
            className={BTN}
            title="Replay the decision path"
          >
            ⟳ REPLAY <span className="kbd ml-1">r</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[290px_minmax(0,1fr)_360px]">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <CustomerCard trace={trace} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.08 }}
          className="panel relative min-h-[460px] overflow-hidden"
        >
          <FlowGraph trace={trace} onDoc={onDoc} flipped={flipped} onList={onList} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.16 }}
          className="panel min-h-[400px] overflow-y-auto p-4"
        >
          <DecisionPath trace={trace} runId={runId} onDoc={onDoc} />
        </motion.div>
      </div>

      <FlipCard trace={trace} flipped={flipped} onToggle={toggleFlip} />

      <EvidenceDrawer
        institution={trace.institution}
        docId={doc}
        txList={txList}
        onDoc={onDoc}
        onClose={closeTop}
        docUrl={docUrl}
      />
    </div>
  );
}
