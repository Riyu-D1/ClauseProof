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
              <div className="flex items-center gap-2.5">
                <span className="label">Evidence</span>
                <span className="mono rounded border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-bold text-accent">
                  {docId}
                </span>
              </div>
              <button
                autoFocus
                onClick={onClose}
                className="mono rounded border border-line px-2 py-1 text-[10px] tracking-[0.1em] text-ink-300 transition-colors hover:border-line-2 hover:text-ink-100"
              >
                ESC ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
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
                    verdict but is not a document in <code>{institution}/evidence/</code> — it may
                    be a transaction or internal-list entry.
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
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
