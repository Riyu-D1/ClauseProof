"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Trace } from "@/lib/types";

type Kind = "entity" | "country";

interface Subject {
  kind: Kind;
  name: string;
  tag: string;
}

interface Finding {
  title: string;
  url: string;
  domain: string;
  snippet: string;
}

interface QResult {
  label: string;
  query: string;
  cached: boolean;
  answer: string | null;
  findings: Finding[];
  error?: string;
}

interface Report {
  ok: boolean;
  offline?: boolean;
  offline_reason?: string;
  signal?: "clean" | "namesake" | "adverse";
  signal_label?: string;
  queries?: QResult[];
  took_ms?: number;
}

const SIGNAL_COLOR = {
  clean: "#2bd47d",
  namesake: "#ffb020",
  adverse: "#ff3b5c",
} as const;

// own-name / generic bookkeeping labels that aren't real counterparties
const SKIP_CP = /^(cash deposit|cash withdrawal|internal transfer|own account|balance|fees?|charges?)/i;

export default function OsintPanel({ trace }: { trace: Trace }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [customKind, setCustomKind] = useState<Kind>("entity");
  const [active, setActive] = useState<Subject | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  const groups = useMemo(() => {
    const cps = [
      ...new Set(
        trace.coverage
          .map((r) => r.counterparty)
          .filter((n) => n && n !== trace.customer.name && !SKIP_CP.test(n))
      ),
    ].slice(0, 8);
    const countries = [
      ...new Set([
        ...trace.coverage.map((r) => r.country),
        ...(trace.customer.expected_countries ?? []),
      ]),
    ]
      .filter(Boolean)
      .sort((a, b) => Number(b !== "United Kingdom") - Number(a !== "United Kingdom"));
    return {
      customer: [{ kind: "entity" as Kind, name: trace.customer.name, tag: "customer" }],
      counterparties: cps.map((n) => ({ kind: "entity" as Kind, name: n, tag: "counterparty" })),
      countries: countries.map((n) => ({ kind: "country" as Kind, name: n, tag: "country" })),
    };
  }, [trace]);

  const research = useCallback(async (s: Subject) => {
    setActive(s);
    setReport(null);
    setLoading(true);
    setOpen(true);
    const id = ++seq.current;
    try {
      const r = await fetch("/api/osint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: s.kind, name: s.name }),
      });
      const j = (await r.json()) as Report;
      if (seq.current === id) setReport(j);
    } catch {
      if (seq.current === id) setReport({ ok: false, offline: true, offline_reason: "network_error" });
    } finally {
      if (seq.current === id) setLoading(false);
    }
  }, []);

  // capture phase + stopImmediatePropagation so CaseBoard's Escape→queue handler
  // doesn't fire while this drawer is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA") {
        if (e.key === "Escape") el.blur();
        return;
      }
      if (e.key === "Escape" && open) {
        e.stopImmediatePropagation();
        setOpen(false);
      } else if (e.key === "o" && !open) {
        e.stopImmediatePropagation();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open]);

  const chip = (s: Subject) => {
    const on = active?.name === s.name && active?.kind === s.kind;
    return (
      <button
        key={`${s.kind}:${s.name}`}
        onClick={() => research(s)}
        className={`mono rounded-md border px-2 py-1 text-left text-[10.5px] leading-tight transition-colors ${
          on
            ? "border-[#37e0d860] bg-[#37e0d812] text-accent"
            : "border-white/10 text-ink-300 hover:border-white/25 hover:text-ink-100"
        }`}
      >
        {s.name}
      </button>
    );
  };

  const offlineText: Record<string, string> = {
    no_api_key: "TAVILY_API_KEY is not set — add it to the repo-root .env to enable live checks.",
    upstream_unreachable: "The Tavily API could not be reached — check the network connection.",
    network_error: "The request never reached the server — is `next dev` running?",
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="mono rounded-lg border border-white/10 px-2.5 py-1.5 text-[11px] text-ink-300 hover:border-[#37e0d855] hover:text-ink-100"
        title="Research counterparty — live OSINT, context only"
      >
        ⌕ osint <span className="kbd ml-1">o</span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
              onClick={() => setOpen(false)}
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 34 }}
              className="fixed bottom-0 right-0 top-0 z-50 flex w-[480px] max-w-[94vw] flex-col border-l border-white/10 bg-obsidian-900"
            >
              <div className="flex items-center justify-between border-b border-white/[0.07] px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="mono text-[10px] tracking-[0.18em] text-ink-500">LIVE OSINT</span>
                  <span className="mono rounded-md border border-[#ffb02040] bg-[#ffb02010] px-2 py-0.5 text-[10px] text-[#ffb020]">
                    context only · not used in the verdict
                  </span>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  className="mono rounded-md border border-white/10 px-2 py-1 text-[11px] text-ink-300 hover:border-white/30"
                >
                  esc ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4">
                {/* subject picker */}
                <p className="mono text-[10px] tracking-[0.16em] text-ink-500">RESEARCH SUBJECT</p>
                <div className="mt-2 flex flex-col gap-2.5">
                  <div className="flex flex-wrap gap-1.5">{groups.customer.map(chip)}</div>
                  {groups.counterparties.length > 0 && (
                    <div>
                      <p className="mono mb-1 text-[9.5px] tracking-[0.14em] text-ink-600">
                        COUNTERPARTIES
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {groups.counterparties.map(chip)}
                      </div>
                    </div>
                  )}
                  {groups.countries.length > 0 && (
                    <div>
                      <p className="mono mb-1 text-[9.5px] tracking-[0.14em] text-ink-600">
                        COUNTRIES · FATF / UK high-risk status
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {groups.countries.map(chip)}
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5">
                    <input
                      value={custom}
                      onChange={(e) => setCustom(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && custom.trim().length >= 2) {
                          research({ kind: customKind, name: custom.trim(), tag: "custom" });
                        }
                      }}
                      placeholder="custom subject…"
                      className="mono min-w-0 flex-1 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-[10.5px] text-ink-100 placeholder:text-ink-600 focus:border-[#37e0d860] focus:outline-none"
                    />
                    <button
                      onClick={() => setCustomKind(customKind === "entity" ? "country" : "entity")}
                      className="mono rounded-md border border-white/10 px-2 py-1 text-[10px] text-ink-400 hover:border-white/25"
                      title="toggle subject type"
                    >
                      {customKind}
                    </button>
                    <button
                      disabled={custom.trim().length < 2}
                      onClick={() =>
                        research({ kind: customKind, name: custom.trim(), tag: "custom" })
                      }
                      className="mono rounded-md border border-[#37e0d840] bg-[#37e0d810] px-2 py-1 text-[10px] text-accent hover:bg-[#37e0d820] disabled:opacity-30"
                    >
                      run
                    </button>
                  </div>
                </div>

                {/* results */}
                <div className="mt-5">
                  {loading && (
                    <div className="flex flex-col gap-3 pt-2">
                      {[64, 40, 88, 72, 52].map((w, i) => (
                        <div
                          key={i}
                          className="h-3 animate-pulse rounded bg-white/[0.06]"
                          style={{ width: `${w}%` }}
                        />
                      ))}
                      <p className="mono mt-1 text-[10px] text-ink-600">
                        querying tavily · {active?.name}
                      </p>
                    </div>
                  )}

                  {!loading && report?.offline && (
                    <div className="panel border-[#ffb02030] p-4">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-1.5 w-1.5 rounded-full"
                          style={{ background: "#ffb020", boxShadow: "0 0 8px #ffb020" }}
                        />
                        <span className="mono text-[11px] font-semibold tracking-wide text-[#ffb020]">
                          OSINT OFFLINE
                        </span>
                      </div>
                      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-300">
                        {offlineText[report.offline_reason ?? ""] ??
                          "Live OSINT is unavailable right now."}
                      </p>
                      <p className="mt-2 text-[11.5px] text-ink-500">
                        The verdict, reason code and evidence on this case are unchanged — they were
                        produced offline by the scored engine.
                      </p>
                    </div>
                  )}

                  {!loading && report?.ok && (
                    <>
                      {/* signal banner */}
                      <div
                        className="panel p-4"
                        style={{ borderColor: `${SIGNAL_COLOR[report.signal ?? "clean"]}35` }}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-1.5 w-1.5 rounded-full"
                            style={{
                              background: SIGNAL_COLOR[report.signal ?? "clean"],
                              boxShadow: `0 0 8px ${SIGNAL_COLOR[report.signal ?? "clean"]}`,
                            }}
                          />
                          <span
                            className="mono text-[11px] font-semibold tracking-wide"
                            style={{ color: SIGNAL_COLOR[report.signal ?? "clean"] }}
                          >
                            {report.signal_label}
                          </span>
                          <span className="mono ml-auto text-[9.5px] text-ink-600">
                            {report.took_ms}ms
                          </span>
                        </div>
                        <p className="mono mt-1.5 text-[10.5px] text-ink-400">
                          {active?.tag} · {active?.name}
                        </p>
                      </div>

                      {/* per-query findings */}
                      <div className="mt-3 flex flex-col gap-3">
                        {(report.queries ?? []).map((q, i) => (
                          <div key={i} className="panel p-3.5">
                            <div className="flex items-center gap-2">
                              <span className="mono text-[10px] font-semibold tracking-[0.12em] text-ink-300">
                                {q.label.toUpperCase()}
                              </span>
                              <span
                                className={`mono ml-auto rounded border px-1.5 py-0.5 text-[9px] ${
                                  q.error
                                    ? "border-[#ff3b5c40] bg-[#ff3b5c10] text-[#ff3b5c]"
                                    : q.cached
                                      ? "border-white/10 bg-white/[0.04] text-ink-400"
                                      : "border-[#37e0d840] bg-[#37e0d810] text-accent"
                                }`}
                              >
                                {q.error ? "ERROR" : q.cached ? "CACHED" : "LIVE"}
                              </span>
                            </div>
                            <p className="mono mt-1 break-all text-[9.5px] leading-relaxed text-ink-600">
                              {q.query}
                            </p>
                            {q.error && (
                              <p className="mt-2 text-[11.5px] text-[#ff3b5c]">
                                call failed ({q.error}) — {q.cached ? "serving cache" : "no data"}
                              </p>
                            )}
                            {q.answer && (
                              <p className="mt-2 border-l-2 border-[#37e0d840] pl-2.5 text-[12px] leading-relaxed text-ink-300">
                                {q.answer}
                              </p>
                            )}
                            <div className="mt-2 flex flex-col gap-2.5">
                              {q.findings.map((f, j) => (
                                <div key={j} className="border-t border-white/[0.05] pt-2">
                                  <a
                                    href={f.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[12px] font-medium leading-snug text-ink-100 hover:text-accent"
                                  >
                                    {f.title} <span className="text-ink-500">↗</span>
                                  </a>
                                  <div className="mono mt-0.5 text-[9.5px] text-ink-600">
                                    {f.domain}
                                  </div>
                                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink-400">
                                    {f.snippet}
                                    {f.snippet.length >= 320 ? "…" : ""}
                                  </p>
                                </div>
                              ))}
                              {!q.error && q.findings.length === 0 && (
                                <p className="border-t border-white/[0.05] pt-2 text-[11.5px] text-ink-500">
                                  no results returned
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 rounded-lg border border-[#ffb02025] bg-[#ffb02008] p-3.5">
                        <p className="mono text-[9.5px] tracking-[0.14em] text-[#ffb020]">
                          READ WITH CARE
                        </p>
                        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-300">
                          Dataset names are fictional, so hits on them are almost certainly{" "}
                          <strong className="text-ink-100">namesakes</strong>, not the party in this
                          case. A real deployment would screen against licensed data (e.g. Dow
                          Jones, ComplyAdvantage, Companies House) with entity resolution — this
                          demo uses raw web search only.
                        </p>
                      </div>
                    </>
                  )}

                  {!loading && !report && (
                    <p className="pt-2 text-[12px] text-ink-500">
                      Pick a subject above — or type a custom name — to run a live check against the
                      public web via Tavily. Results are cached on disk so repeat clicks are free.
                    </p>
                  )}
                </div>

                <div className="mt-5 border-t border-white/[0.06] pb-3 pt-3">
                  <p className="mono text-[9px] leading-relaxed tracking-[0.1em] text-ink-600">
                    LIVE OSINT · CONTEXT ONLY · NOT USED IN THE VERDICT · MAX 3 QUERIES PER RUN ·
                    CACHED IN web/.cache/osint/
                  </p>
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
