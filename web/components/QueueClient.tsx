"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import VerdictPill from "@/components/VerdictPill";
import { gbpShort, pct } from "@/lib/format";
import {
  INSTITUTION_LABEL,
  type Manifest,
  type Repro,
  type Trace,
  type Verdict,
} from "@/lib/types";

const VERDICTS: Verdict[] = ["CLOSE", "RFI", "ESCALATE"];

function ProofBar({
  traces,
  repro,
}: {
  traces: Trace[];
  repro: Repro | null;
}) {
  const counts = useMemo(() => {
    const m: Record<Verdict, number> = { CLOSE: 0, RFI: 0, ESCALATE: 0 };
    traces.forEach((t) => m[t.verdict]++);
    return m;
  }, [traces]);
  const total = traces.length;
  const stats = [
    { label: "CASES TRIAGED", value: String(total), color: "#37e0d8" },
    { label: "CLOSED", value: `${pct(counts.CLOSE, total)}%`, color: "#2bd47d" },
    { label: "RFI", value: `${pct(counts.RFI, total)}%`, color: "#ffb020" },
    { label: "ESCALATED", value: `${pct(counts.ESCALATE, total)}%`, color: "#ff3b5c" },
  ];
  return (
    <div className="panel flex items-stretch divide-x divide-white/[0.06] overflow-hidden">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-1 flex-col gap-0.5 px-5 py-3.5">
          <span className="mono text-[10px] tracking-[0.16em] text-ink-500">{s.label}</span>
          <span className="mono text-2xl font-semibold" style={{ color: s.color }}>
            {s.value}
          </span>
        </div>
      ))}
      {repro && (
        <div className="flex flex-1 flex-col justify-center gap-0.5 px-5 py-3.5">
          <span className="mono text-[10px] tracking-[0.16em] text-ink-500">REPRODUCIBILITY</span>
          <span className="flex items-center gap-2">
            <span className="mono text-2xl font-semibold text-accent">
              {repro.identical_verdicts && repro.identical_reason_codes
                ? `${repro.runs ?? 5}/${repro.runs ?? 5}`
                : "—"}
            </span>
            <span className="mono text-[10px] text-ink-500">
              identical runs{repro.fixture ? " · example" : ""}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

export default function QueueClient({
  manifest,
  traces,
  repro,
}: {
  manifest: Manifest | null;
  traces: Record<string, Trace[]>;
  repro: Repro | null;
}) {
  const router = useRouter();
  const institutions = useMemo(() => manifest?.institutions ?? [], [manifest]);
  const [tab, setTab] = useState(institutions[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = traces[tab] ?? [];
    if (!q) return all;
    return all.filter(
      (t) =>
        t.case_id.toLowerCase().includes(q) ||
        t.customer.name.toLowerCase().includes(q) ||
        t.coverage.some((c) => c.counterparty.toLowerCase().includes(q)) ||
        t.reason_code.toLowerCase().includes(q)
    );
  }, [traces, tab, query]);

  useEffect(() => setCursor(0), [tab, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === "j") setCursor((c) => Math.min(c + 1, rows.length - 1));
      else if (e.key === "k") setCursor((c) => Math.max(c - 1, 0));
      else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Enter" && rows[cursor]) {
        router.push(`/case/${rows[cursor].case_id}`);
      } else if (/^[1-4]$/.test(e.key) && institutions[+e.key - 1]) {
        setTab(institutions[+e.key - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, cursor, router, institutions]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const allTraces = Object.values(traces).flat();

  if (!manifest || manifest.total_cases === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <div className="panel max-w-md p-8 text-center">
          <p className="mono text-[11px] tracking-[0.2em] text-ink-500">NO DATA</p>
          <h2 className="mt-2 text-lg font-semibold text-ink-100">No traces loaded yet</h2>
          <p className="mt-2 text-sm text-ink-300">
            Run <code className="mono text-accent">node scripts/import-traces.mjs</code> to
            import engine traces or generate fixture data.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-5 p-5">
      <ProofBar traces={allTraces} repro={manifest.repro ? repro : null} />

      {/* institution tabs */}
      <div className="flex items-center gap-2">
        {institutions.map((inst, i) => {
          const active = inst.id === tab;
          const instTraces = traces[inst.id] ?? [];
          const counts = { CLOSE: 0, RFI: 0, ESCALATE: 0 } as Record<Verdict, number>;
          instTraces.forEach((t) => counts[t.verdict]++);
          return (
            <button
              key={inst.id}
              onClick={() => setTab(inst.id)}
              className={`panel panel-hover relative flex items-center gap-3 px-4 py-2.5 text-left ${
                active ? "!border-[#37e0d855]" : ""
              }`}
              style={active ? { background: "rgba(55,224,216,0.05)" } : undefined}
            >
              <span className="mono text-[10px] text-ink-600">{i + 1}</span>
              <span className="flex flex-col">
                <span className={`text-[13px] font-medium ${active ? "text-ink-100" : "text-ink-300"}`}>
                  {INSTITUTION_LABEL[inst.id] ?? inst.id}
                </span>
                <span className="mono flex items-center gap-1.5 text-[10px] text-ink-500">
                  {inst.cases} cases
                  {VERDICTS.map((v) =>
                    counts[v] ? (
                      <span key={v} className="flex items-center gap-1">
                        <span
                          className="inline-block h-1 w-1 rounded-full"
                          style={{
                            background:
                              v === "CLOSE" ? "#2bd47d" : v === "RFI" ? "#ffb020" : "#ff3b5c",
                          }}
                        />
                        {counts[v]}
                      </span>
                    ) : null
                  )}
                </span>
              </span>
              {active && (
                <motion.span
                  layoutId="tab-glow"
                  className="absolute inset-x-3 -bottom-px h-px"
                  style={{ background: "linear-gradient(90deg, transparent, #37e0d8, transparent)" }}
                />
              )}
            </button>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search cases, customers, counterparties…"
              className="mono w-[300px] rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[12px] text-ink-100 outline-none placeholder:text-ink-600 focus:border-[#37e0d860]"
            />
            <span className="kbd absolute right-2.5 top-1/2 -translate-y-1/2">/</span>
          </div>
          <span className="mono hidden items-center gap-1.5 text-[10px] text-ink-600 lg:flex">
            <span className="kbd">j</span>
            <span className="kbd">k</span> navigate
            <span className="kbd">↵</span> open
          </span>
        </div>
      </div>

      {/* queue */}
      <div ref={listRef} className="flex flex-col gap-2 pb-8">
        <AnimatePresence mode="popLayout">
          {rows.map((t, i) => {
            const flagged = t.coverage.reduce((s, c) => s + c.amount_gbp, 0);
            const uncovered = t.coverage.filter((c) => !c.covered_by).length;
            const selected = i === cursor;
            return (
              <motion.button
                layout
                key={t.case_id}
                data-idx={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, delay: Math.min(i * 0.02, 0.2) }}
                onClick={() => router.push(`/case/${t.case_id}`)}
                onMouseEnter={() => setCursor(i)}
                className={`panel panel-hover group flex items-center gap-4 px-4 py-3 text-left ${
                  selected ? "!border-[#37e0d845]" : ""
                }`}
              >
                <span
                  className="mono w-5 text-right text-[11px]"
                  style={{ color: selected ? "#37e0d8" : "#4a5464" }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="flex w-[210px] flex-col">
                  <span className="mono text-[12.5px] font-medium text-ink-100">{t.case_id}</span>
                  <span className="truncate text-[11.5px] text-ink-500">{t.customer.name}</span>
                </div>
                <div className="flex flex-1 flex-wrap items-center gap-1.5">
                  {t.alerts.slice(0, 3).map((a) => (
                    <span
                      key={a.alert_id}
                      title={a.message}
                      className="mono rounded-md border border-white/10 bg-white/[0.03] px-1.5 py-0.5 text-[10px] text-ink-300"
                    >
                      {a.rule_id} · {a.rule_name.split(" ").slice(0, 3).join(" ")}
                    </span>
                  ))}
                  {t.alerts.length > 3 && (
                    <span className="mono text-[10px] text-ink-500">+{t.alerts.length - 3}</span>
                  )}
                </div>
                <div className="hidden w-[130px] flex-col items-end md:flex">
                  <span className="mono text-[12.5px] text-ink-100">{gbpShort(flagged)}</span>
                  <span className="mono text-[10px] text-ink-500">
                    {uncovered ? `${uncovered} unexplained` : "all explained"}
                  </span>
                </div>
                <VerdictPill verdict={t.verdict} />
                <span className="text-ink-600 transition-transform group-hover:translate-x-0.5 group-hover:text-accent">
                  →
                </span>
              </motion.button>
            );
          })}
        </AnimatePresence>
        {rows.length === 0 && (
          <div className="panel p-10 text-center">
            <p className="mono text-[11px] tracking-[0.2em] text-ink-500">EMPTY</p>
            <p className="mt-2 text-sm text-ink-300">No cases match “{query}”.</p>
          </div>
        )}
      </div>
    </div>
  );
}
