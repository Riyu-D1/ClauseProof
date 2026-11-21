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
  clean: "#38d07d",
  namesake: "#ffb224",
  adverse: "#ff5566",
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
        data-osint-chip
        onClick={() => research(s)}
        className={`mono rounded border px-2 py-1 text-left text-[10.5px] leading-tight tracking-[0.04em] transition-colors ${
          on
            ? "border-accent/60 bg-accent/10 text-accent"
            : "border-line text-ink-300 hover:border-line-2 hover:text-ink-100"
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
        className="mono flex h-8 items-center rounded-md border border-line px-3 text-[10.5px] tracking-[0.1em] text-ink-300 transition-colors hover:border-line-2 hover:text-ink-100"
        title="Research counterparty — live OSINT, context only"
      >
        ⌕ OSINT <span className="kbd ml-1.5">o</span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60"
              onClick={() => setOpen(false)}
            />
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
              className="fixed bottom-0 right-0 top-0 z-50 flex w-[500px] max-w-[94vw] flex-col border-l border-line-2 bg-obsidian-900"
            >
              <div className="flex h-14 items-center justify-between border-b border-line px-5">
                <div className="flex items-center gap-2.5">
                  <span className="label">Live OSINT</span>
                  <span className="mono rounded border border-[#ffb22444] px-2 py-0.5 text-[9.5px] tracking-[0.1em] text-rfi">
                    CONTEXT ONLY · NOT USED IN THE VERDICT
                  </span>
                </div>
                <button
                  autoFocus
                  onClick={() => setOpen(false)}
                  className="mono rounded border border-line px-2 py-1 text-[10px] tracking-[0.1em] text-ink-300 transition-colors hover:border-line-2 hover:text-ink-100"
                >
                  ESC ✕
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-5">
                {/* subject picker */}
                <p className="label">Research subject</p>
                <div className="mt-2.5 flex flex-col gap-3">
                  <div className="flex flex-wrap gap-1.5">{groups.customer.map(chip)}</div>
                  {groups.counterparties.length > 0 && (
                    <div>
                      <p className="label mb-1.5" style={{ fontSize: "9.5px" }}>
                        Counterparties
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {groups.counterparties.map(chip)}
                      </div>
                    </div>
                  )}
                  {groups.countries.length > 0 && (
                    <div>
                      <p className="label mb-1.5" style={{ fontSize: "9.5px" }}>
                        Countries · FATF / UK high-risk status
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
                      className="mono min-w-0 flex-1 rounded-md border border-line bg-obsidian-850 px-2.5 py-1.5 text-[10.5px] text-ink-100 placeholder:text-ink-600 focus:border-accent focus:outline-none"
                    />
                    <button
                      onClick={() => setCustomKind(customKind === "entity" ? "country" : "entity")}
                      className="mono rounded border border-line px-2 py-1.5 text-[10px] uppercase text-ink-400 transition-colors hover:border-line-2"
                      title="toggle subject type"
                    >
                      {customKind}
                    </button>
                    <button
                      disabled={custom.trim().length < 2}
                      onClick={() =>
                        research({ kind: customKind, name: custom.trim(), tag: "custom" })
                      }
                      className="mono rounded border border-accent/50 bg-accent/10 px-2.5 py-1.5 text-[10px] font-bold tracking-[0.08em] text-accent transition-colors hover:bg-accent/20 disabled:opacity-30"
                    >
                      RUN
                    </button>
                  </div>
                </div>

                {/* results */}
                <div className="mt-6">
                  {loading && (
                    <div className="pt-2">
                      <p className="mono text-[11px] tracking-[0.18em] text-ink-500">
                        <span className="cp-dots">[ QUERYING TAVILY</span>
                        <span> ]</span>
                      </p>
                      <p className="mono mt-2 text-[10px] text-ink-500">
                        {active?.tag} · {active?.name}
                      </p>
                    </div>
                  )}

                  {!loading && report?.offline && (
                    <div className="panel p-4" style={{ borderColor: "#ffb22440" }}>
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-[5px] w-[5px] rounded-full"
                          style={{ background: "#ffb224" }}
                        />
                        <span className="mono text-[11px] font-bold tracking-[0.14em] text-rfi">
                          OSINT OFFLINE
                        </span>
                      </div>
                      <p className="mt-2 text-[12.5px] leading-relaxed text-ink-300">
                        {offlineText[report.offline_reason ?? ""] ??
                          "Live OSINT is unavailable right now."}
                      </p>
                      <p className="mt-2 text-[11.5px] text-ink-400">
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
                        style={{ borderColor: `${SIGNAL_COLOR[report.signal ?? "clean"]}40` }}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block h-[5px] w-[5px] rounded-full"
                            style={{ background: SIGNAL_COLOR[report.signal ?? "clean"] }}
                          />
                          <span
                            className="mono text-[11px] font-bold tracking-[0.14em]"
                            style={{ color: SIGNAL_COLOR[report.signal ?? "clean"] }}
                          >
                            {report.signal_label}
                          </span>
                          <span className="mono ml-auto text-[9.5px] text-ink-500">
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
                          <div key={i} className="panel p-4">
                            <div className="flex items-center gap-2">
                              <span className="mono text-[10px] font-bold tracking-[0.14em] text-ink-300">
                                {q.label.toUpperCase()}
                              </span>
                              <span
                                className={`mono ml-auto rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-[0.1em] ${
                                  q.error
                                    ? "border-[#ff556640] bg-[#ff556610] text-[#ff5566]"
                                    : q.cached
                                      ? "border-line bg-obsidian-800 text-ink-400"
                                      : "border-accent/40 bg-accent/10 text-accent"
                                }`}
                              >
                                {q.error ? "ERROR" : q.cached ? "CACHED" : "LIVE"}
                              </span>
                            </div>
                            <p className="mono mt-1.5 break-all text-[9.5px] leading-relaxed text-ink-500">
                              {q.query}
                            </p>
                            {q.error && (
                              <p className="mt-2 text-[11.5px] text-[#ff5566]">
                                call failed ({q.error}) — {q.cached ? "serving cache" : "no data"}
                              </p>
                            )}
                            {q.answer && (
                              <p className="mt-2 border-l-2 border-accent/40 pl-3 text-[12px] leading-relaxed text-ink-300">
                                {q.answer}
                              </p>
                            )}
                            <div className="mt-2 flex flex-col gap-2.5">
                              {q.findings.map((f, j) => (
                                <div key={j} className="border-t border-line pt-2.5">
                                  <a
                                    href={f.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[12px] font-medium leading-snug text-ink-100 transition-colors hover:text-accent"
                                  >
                                    {f.title} <span className="text-ink-500">↗</span>
                                  </a>
                                  <div className="mono mt-0.5 text-[9.5px] text-ink-500">
                                    {f.domain}
                                  </div>
                                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink-400">
                                    {f.snippet}
                                    {f.snippet.length >= 320 ? "…" : ""}
                                  </p>
                                </div>
                              ))}
                              {!q.error && q.findings.length === 0 && (
                                <p className="border-t border-line pt-2.5 text-[11.5px] text-ink-500">
                                  no results returned
                                </p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 rounded-lg border border-[#ffb22433] p-4">
                        <p className="mono text-[9.5px] font-bold tracking-[0.16em] text-rfi">
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
                    <p className="pt-2 text-[12px] leading-relaxed text-ink-400">
                      Pick a subject above — or type a custom name — to run a live check against the
                      public web via Tavily. Results are cached on disk so repeat clicks are free.
                    </p>
                  )}
                </div>

                <div className="mt-6 border-t border-line pb-3 pt-3">
                  <p className="mono text-[9px] leading-relaxed tracking-[0.12em] text-ink-500">
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
