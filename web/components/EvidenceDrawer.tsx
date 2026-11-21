"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ccode, fmtDateTime, gbp } from "@/lib/format";
import type { TxListing } from "@/lib/types";

interface DocPayload {
  doc_id: string;
  type: string;
  title: string;
  dated: string;
  markdown: string;
}

const DOC_ID = /^[A-Z]{2,5}-\d+$/;
const COVERED = "#38d07d";
const UNCOVERED = "#ff5566";

export default function EvidenceDrawer({
  institution,
  docId,
  txList,
  onDoc,
  onClose,
}: {
  institution: string;
  docId: string | null;
  txList?: TxListing | null;
  onDoc?: (id: string) => void;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<DocPayload | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const open = !!docId || !!txList;

  useEffect(() => {
    if (!docId) return;
    let dead = false;
    setLoading(true);
    setDoc(null);
    setMissing(null);
    fetch(`/api/evidence?institution=${institution}&doc=${encodeURIComponent(docId)}`)
      .then(async (r) => {
        if (dead) return;
        if (r.ok) setDoc(await r.json());
        else setMissing(docId);
      })
      .catch(() => !dead && setMissing(docId))
      .finally(() => !dead && setLoading(false));
    return () => {
      dead = true;
    };
  }, [docId, institution]);

  const listTotal = txList?.rows.reduce((s, r) => s + r.amount_gbp, 0) ?? 0;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/60"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
            className="fixed bottom-0 right-0 top-0 z-50 flex w-[480px] max-w-[94vw] flex-col border-l border-line-2 bg-obsidian-900"
          >
            <div className="flex h-14 items-center justify-between border-b border-line px-5">
              {docId ? (
                <div className="flex items-center gap-2.5">
                  <span className="label">Evidence</span>
                  <span className="mono rounded border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-bold text-accent">
                    {docId}
                  </span>
                </div>
              ) : (
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="label">Transactions</span>
                  <span className="mono truncate rounded border border-line bg-obsidian-800 px-2 py-0.5 text-[10.5px] text-ink-100">
                    {txList!.title}
                  </span>
                  <span className="mono shrink-0 rounded border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10.5px] font-bold text-accent">
                    {txList!.rows.length}
                  </span>
                </div>
              )}
              <button
                autoFocus
                onClick={onClose}
                className="mono shrink-0 rounded border border-line px-2 py-1 text-[10px] tracking-[0.1em] text-ink-300 transition-colors hover:border-line-2 hover:text-ink-100"
              >
                {docId && txList ? "← LIST" : "ESC ✕"}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {docId ? (
                <>
                  {loading && (
                    <p className="mono pt-4 text-[11px] tracking-[0.18em] text-ink-500">
                      <span className="cp-dots">[ FETCHING DOCUMENT</span>
                      <span> ]</span>
                    </p>
                  )}
                  {missing && (
                    <div className="panel mt-2 p-4">
                      <p className="label">Not a document</p>
                      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-300">
                        <code className="mono text-accent">{missing}</code> is referenced by the
                        verdict but is not a document in <code>{institution}/evidence/</code> — it
                        may be a transaction or internal-list entry.
                      </p>
                    </div>
                  )}
                  {doc && (
                    <>
                      <div className="mb-4 flex flex-wrap items-center gap-2">
                        <span className="mono rounded border border-line bg-obsidian-800 px-2 py-0.5 text-[9.5px] uppercase tracking-[0.12em] text-ink-300">
                          {doc.type}
                        </span>
                        {doc.dated && (
                          <span className="mono text-[10.5px] text-ink-500">dated {doc.dated}</span>
                        )}
                      </div>
                      <article className="evidence-md">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.markdown}</ReactMarkdown>
                      </article>
                    </>
                  )}
                </>
              ) : (
                txList && (
                  <>
                    {txList.sub && (
                      <p className="mono mb-4 text-[10px] tracking-[0.14em] text-ink-500">
                        {txList.sub}
                      </p>
                    )}
                    <div className="flex flex-col gap-2">
                      {[...txList.rows]
                        .sort((a, b) => a.booked_at.localeCompare(b.booked_at))
                        .map((r) => {
                          const docOk = !!r.covered_by && DOC_ID.test(r.covered_by);
                          return (
                            <div
                              key={r.transaction_id}
                              className="rounded-lg border border-line bg-obsidian-850 px-3 py-2.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="mono text-[10.5px] font-bold text-ink-100">
                                  {r.transaction_id}
                                </span>
                                <span className="mono text-[11px] text-ink-100">
                                  {r.direction === "in" ? "→" : "←"} {gbp(r.amount_gbp)}
                                </span>
                              </div>
                              <div className="mt-1 flex items-center gap-2">
                                <span className="ctag" title={r.country}>
                                  {ccode(r.country)}
                                </span>
                                <span className="truncate text-[11.5px] text-ink-300">
                                  {r.counterparty || "Unknown party"}
                                </span>
                                <span className="mono ml-auto shrink-0 text-[9.5px] text-ink-600">
                                  {fmtDateTime(r.booked_at)}
                                </span>
                              </div>
                              <div className="mt-1.5 flex items-center gap-1.5">
                                {r.covered_by ? (
                                  docOk ? (
                                    <button
                                      className="edge-chip"
                                      style={{
                                        background: "var(--color-obsidian-800)",
                                        color: COVERED,
                                        border: `1px solid ${COVERED}55`,
                                      }}
                                      title={`open ${r.covered_by}`}
                                      onClick={() => onDoc?.(r.covered_by!)}
                                    >
                                      ✓ {r.covered_by}
                                    </button>
                                  ) : (
                                    <span
                                      className="edge-chip"
                                      style={{
                                        background: "var(--color-obsidian-800)",
                                        color: COVERED,
                                        border: `1px solid ${COVERED}55`,
                                        cursor: "default",
                                      }}
                                    >
                                      ✓ {r.covered_by}
                                    </span>
                                  )
                                ) : (
                                  <span
                                    className="edge-chip"
                                    style={{
                                      background: "var(--color-obsidian-800)",
                                      color: UNCOVERED,
                                      border: `1px solid ${UNCOVERED}66`,
                                    }}
                                  >
                                    ? unexplained
                                  </span>
                                )}
                                {txList.heldId === r.transaction_id && (
                                  <span
                                    className="edge-chip"
                                    style={{
                                      background: "var(--color-obsidian-800)",
                                      color: "#ffb224",
                                      border: "1px solid #ffb22455",
                                    }}
                                  >
                                    HELD
                                  </span>
                                )}
                                <span
                                  className="min-w-0 truncate text-[10.5px] text-ink-500"
                                  title={r.why}
                                >
                                  {r.why}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                    <div className="mono mt-4 flex items-center justify-between border-t border-line pt-3 text-[10.5px] tracking-[0.08em] text-ink-400">
                      <span>TOTAL · {txList.rows.length} TXNS</span>
                      <span className="text-ink-100">{gbp(listTotal)}</span>
                    </div>
                  </>
                )
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
