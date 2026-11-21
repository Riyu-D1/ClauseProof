"use client";

import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CustomerCard from "@/components/CustomerCard";
import DecisionPath from "@/components/DecisionPath";
import EvidenceDrawer from "@/components/EvidenceDrawer";
import FlipCard from "@/components/FlipCard";
import FlowGraph from "@/components/FlowGraph";
import ShortcutHelp from "@/components/ShortcutHelp";
import OsintPanel from "@/components/OsintPanel";
import { VERDICT_COLOR, fmtDateTime } from "@/lib/format";
import type { LiveDecision } from "@/lib/case-run";
import { INSTITUTION_LABEL, type Trace, type TxListing, type Verdict } from "@/lib/types";

interface Peer {
  case_id: string;
  verdict: Verdict;
  name: string;
}

const BTN =
  "mono flex h-8 items-center rounded-md border border-line px-3 text-[10.5px] tracking-[0.1em] text-ink-300 transition-colors hover:border-line-2 hover:text-ink-100 disabled:opacity-30";

export default function CaseBoard({
  trace,
  peers,
  precomputedAt,
}: {
  trace: Trace;
  peers: Peer[];
  precomputedAt: string | null;
}) {
  const router = useRouter();
  const [doc, setDoc] = useState<string | null>(null);
  const [txList, setTxList] = useState<TxListing | null>(null);
  const [runId, setRunId] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [help, setHelp] = useState(false);

  // ---- decide live ----
  const [live, setLive] = useState<LiveDecision | null>(null);
  const [viewLive, setViewLive] = useState(false);
  const [liveRunning, setLiveRunning] = useState(false);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const t0Ref = useRef(0);
  const idx = useMemo(() => peers.findIndex((p) => p.case_id === trace.case_id), [peers, trace]);
  const prev = idx > 0 ? peers[idx - 1] : null;
  const next = idx >= 0 && idx < peers.length - 1 ? peers[idx + 1] : null;

  const decideLive = useCallback(async () => {
    if (liveRunning) return;
    setLiveRunning(true);
    setLiveErr(null);
    t0Ref.current = performance.now();
    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ case_id: trace.case_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setLive(data as LiveDecision);
      setViewLive(true);
      setRunId((n) => n + 1); // re-animate the checks — this run's path, not a replay
    } catch (e) {
      setLiveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLiveRunning(false);
    }
  }, [liveRunning, trace.case_id]);

  // live run ticker — honest wall clock while the engine works
  useEffect(() => {
    if (!liveRunning) return;
    const t = window.setInterval(
      () => setElapsed(performance.now() - t0Ref.current),
      100
    );
    return () => window.clearInterval(t);
  }, [liveRunning]);

  const onDoc = useCallback((id: string) => setDoc(id), []);
  const onList = useCallback(
    (l: TxListing) =>
      setTxList({ ...l, heldId: trace.customer.held_payment_id }),
    [trace.customer.held_payment_id]
  );
  // drawer is layered: doc sits on top of a transaction list
  const closeTop = useCallback(() => {
    if (doc) setDoc(null);
    else setTxList(null);
  }, [doc]);
  const toggleFlip = useCallback(() => setFlipped((f) => !f), []);

  useEffect(() => {
    setFlipped(false);
    setTxList(null);
    setLive(null);
    setViewLive(false);
    setLiveErr(null);
  }, [trace.case_id]);

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
        else if (txList) setTxList(null);
        else router.push("/queue");
      } else if (!doc) {
        if (e.key === "j" && next) router.push(`/case/${next.case_id}`);
        else if (e.key === "k" && prev) router.push(`/case/${prev.case_id}`);
        else if (e.key === "r") setRunId((n) => n + 1);
        else if (e.key === "d") void decideLive();
        else if (e.key === "f" && trace.flip) toggleFlip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc, txList, next, prev, router, trace.flip, toggleFlip, help, decideLive]);

  // the trace on the board: the stored one, or the one decided live just now
  const shownTrace = useMemo<Trace>(() => {
    if (!viewLive || !live?.trace) return trace;
    return {
      ...live.trace,
      // display-only dataset fields the engine doesn't emit — carried over
      // from the stored file so the board stays complete
      customer: { ...trace.customer, ...live.trace.customer },
    };
  }, [viewLive, live, trace]);

  const liveDiffers =
    live != null &&
    (live.verdict !== trace.verdict ||
      live.reason_code !== trace.reason_code ||
      [...live.evidence].sort().join() !== [...trace.evidence].sort().join());

  const vc = VERDICT_COLOR[shownTrace.verdict];

  return (
    <div className="flex min-h-[calc(100vh-88px)] flex-col gap-3 p-4 xl:h-[calc(100vh-88px)] xl:overflow-hidden">
      {/* header strip — case id + verdict are the primary layer */}
      <div className="flex flex-wrap items-center gap-4">
        <button onClick={() => router.push("/queue")} className={BTN}>
          ← QUEUE
        </button>
        <div className="flex flex-col">
          <div className="flex flex-wrap items-center gap-3">
            <span className="doto text-[22px] leading-none text-ink-100">{trace.case_id}</span>
            <span className="mono rounded border border-line bg-obsidian-800 px-1.5 py-0.5 text-[9.5px] tracking-[0.12em] text-ink-400">
              {(INSTITUTION_LABEL[trace.institution] ?? trace.institution).toUpperCase()}
            </span>
            <span
              className="doto text-[22px] leading-none"
              style={{ color: vc }}
            >
              {shownTrace.verdict}
            </span>
            {viewLive && live && (
              <span className="mono rounded border border-accent/50 bg-accent/10 px-1.5 py-0.5 text-[9.5px] font-bold tracking-[0.12em] text-accent">
                LIVE
              </span>
            )}
          </div>
          <span className="mono mt-1.5 text-[10px] tracking-[0.08em] text-ink-500">
            {trace.customer.name} · input {shownTrace.input_hash.slice(0, 12)}…
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <OsintPanel trace={shownTrace} />
          <button
            onClick={() => void decideLive()}
            disabled={liveRunning}
            className={`${BTN} !border-accent/50 !text-accent hover:!border-accent`}
            title="Run the real engine on this case now — one-case folder rebuilt from the dataset"
          >
            {liveRunning ? (
              <span className="cp-dots">RUNNING {(elapsed / 1000).toFixed(1)}s</span>
            ) : (
              <>▶ DECIDE LIVE <span className="kbd ml-1">d</span></>
            )}
          </button>
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

      {/* decided-live status strip — honest about when and whether it agrees */}
      {(live || liveRunning || liveErr) && (
        <div className="panel flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2">
          {liveRunning && (
            <span className="mono text-[10px] tracking-[0.1em] text-accent">
              ENGINE RUNNING — {(elapsed / 1000).toFixed(1)}s · one-case folder rebuilt from the dataset, system/run deciding now
            </span>
          )}
          {liveErr && !liveRunning && (
            <span className="mono text-[10px] tracking-[0.1em] text-escalate">
              LIVE RUN FAILED — {liveErr}
            </span>
          )}
          {live && !liveRunning && (
            <>
              <button
                onClick={() => setViewLive(true)}
                className={`mono rounded border px-2 py-1 text-[9.5px] font-bold tracking-[0.1em] transition-colors ${
                  viewLive ? "border-accent bg-accent/10 text-accent" : "border-line text-ink-400 hover:text-ink-100"
                }`}
                title="Show the run that just happened"
              >
                LIVE — decided just now in {live.ms.toLocaleString("en-GB")}ms
              </button>
              <button
                onClick={() => setViewLive(false)}
                className={`mono rounded border px-2 py-1 text-[9.5px] font-bold tracking-[0.1em] transition-colors ${
                  !viewLive ? "border-accent bg-accent/10 text-accent" : "border-line text-ink-400 hover:text-ink-100"
                }`}
                title="Show the result stored when the queue was generated"
              >
                PRE-COMPUTED{precomputedAt ? ` — ${fmtDateTime(precomputedAt)}` : ""}
              </button>
              {liveDiffers ? (
                <span className="mono rounded border border-escalate/60 bg-escalate/10 px-2 py-1 text-[9.5px] font-bold tracking-[0.08em] text-escalate">
                  DIFFERS — stored {trace.verdict}/{trace.reason_code} → live {live.verdict}/{live.reason_code}
                </span>
              ) : (
                <span className="mono rounded border border-close/50 bg-close/10 px-2 py-1 text-[9.5px] font-bold tracking-[0.08em] text-close">
                  SAME VERDICT + REASON CODE + EVIDENCE ✓
                </span>
              )}
              <span className="mono text-[9px] text-ink-600" title="The live run hashes a one-case slice of the institution files, so its input hash differs from the full-dataset one — the verdict is what matters">
                live input {live.input_hash.slice(0, 12)}… · engine {live.engine_version}
              </span>
            </>
          )}
        </div>
      )}

      {/* main board */}
      <div className="grid flex-1 grid-cols-1 gap-3 xl:min-h-0 xl:grid-cols-[290px_minmax(0,1fr)_360px]">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="min-h-0 xl:overflow-y-auto"
        >
          <CustomerCard trace={shownTrace} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.08 }}
          className="panel relative min-h-[460px] overflow-hidden xl:min-h-0"
        >
          <FlowGraph trace={shownTrace} onDoc={onDoc} flipped={flipped} onList={onList} />
        </motion.div>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.16 }}
          className="panel min-h-[400px] overflow-y-auto p-4 xl:min-h-0"
        >
          <DecisionPath trace={shownTrace} runId={runId} onDoc={onDoc} />
        </motion.div>
      </div>

      <FlipCard trace={shownTrace} flipped={flipped} onToggle={toggleFlip} />

      <EvidenceDrawer
        institution={trace.institution}
        docId={doc}
        txList={txList}
        onDoc={onDoc}
        onClose={closeTop}
      />
      <ShortcutHelp open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
