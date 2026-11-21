"use client";

import { useEffect, useState } from "react";
import type { GrokSummary } from "@/lib/grok-assist";

/**
 * "Grok-assisted parsing" switch + per-run counters for the /run page.
 *
 * Drop-in usage (one line on the upload page):
 *   <GrokAssistPanel summary={run.grok} onToggle={setGrok} />
 * then pass "--grok" to the engine spawn when on. The switch defaults ON
 * when the server reports an XAI key configured via GET /api/grok.
 *
 * Grok only reads documents the deterministic parser could not classify;
 * it never decides a verdict. Warm runs serve 100% from the on-disk cache.
 */
export default function GrokAssistPanel({
  onToggle,
  summary,
  defaultOn,
}: {
  onToggle?: (on: boolean) => void;
  summary?: GrokSummary | null;
  defaultOn?: boolean;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [model, setModel] = useState<string>("grok");
  const [on, setOn] = useState<boolean>(defaultOn ?? false);

  useEffect(() => {
    let live = true;
    fetch("/api/grok")
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        setAvailable(Boolean(d.available));
        if (d.model) setModel(d.model);
        if (d.available && defaultOn === undefined) {
          setOn(true);
          onToggle?.(true);
        }
      })
      .catch(() => live && setAvailable(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (v: boolean) => {
    setOn(v);
    onToggle?.(v);
  };

  return (
    <div className="mono rounded border border-line bg-panel px-3 py-2 text-[11px]">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="flex items-center gap-2 tracking-[0.08em] text-ink-300">
          GROK-ASSISTED PARSING
          <span
            className="rounded px-1.5 py-[1px] text-[9px] font-bold tracking-[0.08em]"
            style={{
              color: available ? "#7ee0a3" : "#8a8f98",
              background: available ? "#7ee0a314" : "#8a8f9814",
              border: `1px solid ${available ? "#7ee0a355" : "#8a8f9855"}`,
            }}
          >
            {available === null
              ? "CHECKING…"
              : available
                ? "KEY CONFIGURED"
                : "NO KEY · CACHE/FIXTURES ONLY"}
          </span>
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          onClick={() => toggle(!on)}
          className="relative h-[18px] w-[34px] rounded-full transition-colors"
          style={{ background: on ? "#7ee0a3" : "#3a3f47" }}
        >
          <span
            className="absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white transition-all"
            style={{ left: on ? 18 : 2 }}
          />
        </button>
      </label>
      <div className="mt-1.5 text-[10px] leading-relaxed text-ink-500">
        {on
          ? `${model} reads evidence the parser cannot classify (temperature 0, cached by sha256). It never decides a verdict.`
          : "Deterministic parser only."}
      </div>
      {summary ? (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-ink-400">
          <span>
            grok-read docs{" "}
            <b className="text-ink-200">{summary.docs_read_by_grok}</b>
          </span>
          <span>
            api calls <b className="text-ink-200">{summary.api_calls}</b>
          </span>
          <span>
            cache hits <b className="text-ink-200">{summary.cache_hits}</b>
          </span>
          {summary.api_calls + summary.cache_hits > 0 && (
            <span>
              hit rate{" "}
              <b className="text-ink-200">
                {Math.round(
                  (100 * summary.cache_hits) /
                    (summary.api_calls + summary.cache_hits)
                )}
                %
              </b>
            </span>
          )}
          {summary.budget_stops > 0 && (
            <span className="text-amber-400">
              budget-stopped {summary.budget_stops}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Small "Grok-read" tag for an evidence row whose doc_id appears in
 * trace.grok.docs. Render inside the evidence list. */
export function GrokReadTag({ note }: { note?: string | null }) {
  return (
    <span
      title={note ?? "Read by Grok"}
      className="mono inline-flex items-center gap-1 rounded px-1.5 py-[1px] text-[9px] font-bold tracking-[0.08em]"
      style={{
        color: "#9db4ff",
        background: "#9db4ff14",
        border: "1px solid #9db4ff55",
      }}
    >
      GROK-READ
    </span>
  );
}
