"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface DocPayload {
  doc_id: string;
  type: string;
  title: string;
  dated: string;
  markdown: string;
}

export default function EvidenceDrawer({
  institution,
  docId,
  onClose,
}: {
  institution: string;
  docId: string | null;
  onClose: () => void;
}) {
  const [doc, setDoc] = useState<DocPayload | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  return (
    <AnimatePresence>
      {docId && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="fixed bottom-0 right-0 top-0 z-50 flex w-[460px] max-w-[92vw] flex-col border-l border-white/10 bg-obsidian-900"
          >
            <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <span className="mono text-[10px] tracking-[0.18em] text-ink-500">EVIDENCE</span>
                <span className="mono rounded-md border border-[#37e0d840] bg-[#37e0d810] px-2 py-0.5 text-[11px] text-accent">
                  {docId}
                </span>
              </div>
              <button
                onClick={onClose}
                className="mono rounded-md border border-white/10 px-2 py-1 text-[11px] text-ink-300 hover:border-white/30"
              >
                esc ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {loading && (
                <div className="flex flex-col gap-3 pt-2">
                  {[64, 40, 88, 72, 52].map((w, i) => (
                    <div
                      key={i}
                      className="h-3 animate-pulse rounded bg-white/[0.06]"
                      style={{ width: `${w}%` }}
                    />
                  ))}
                </div>
              )}
              {missing && (
                <div className="panel mt-2 p-4">
                  <p className="mono text-[10px] tracking-[0.16em] text-ink-500">NOT A DOCUMENT</p>
                  <p className="mt-2 text-[12.5px] text-ink-300">
                    <code className="mono text-accent">{missing}</code> is referenced by the
                    verdict but is not a document in <code>{institution}/evidence/</code> — it may
                    be a transaction or internal-list entry.
                  </p>
                </div>
              )}
              {doc && (
                <>
                  <div className="mb-4 flex flex-wrap items-center gap-2">
                    <span className="mono rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-ink-300">
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
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
