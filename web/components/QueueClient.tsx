"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import RunProof from "@/components/RunProof";
import ShortcutHelp from "@/components/ShortcutHelp";
import VerdictPill from "@/components/VerdictPill";
import { gbpShort, pct } from "@/lib/format";
import {
  INSTITUTION_LABEL,
  type Demo,
  type Manifest,
  type Trace,
  type Verdict,
} from "@/lib/types";

const VERDICTS: Verdict[] = ["CLOSE", "RFI", "ESCALATE"];
const DEMO_TAB = "demo";
const PAGE_SIZE = 60;

function ProofBar({
  manifest,
  institution,
}: {
  manifest: Manifest;
  institution: string;
}) {
  const { counts, total } = useMemo(() => {
    const m: Record<Verdict, number> = { CLOSE: 0, RFI: 0, ESCALATE: 0 };
    let n = 0;
    for (const inst of manifest.institutions) {
      n += inst.cases;
      for (const v of VERDICTS) m[v] += inst.verdicts?.[v] ?? 0;
    }
    return { counts: m, total: n };
  }, [manifest]);
  const stats = [
    { label: "CASES TRIAGED", value: String(total), color: "#37e0d8" },
    { label: "CLOSED", value: `${pct(counts.CLOSE, total)}%`, color: "#2bd47d" },
    { label: "RFI", value: `${pct(counts.RFI, total)}%`, color: "#ffb020" },
    { label: "ESCALATED", value: `${pct(counts.ESCALATE, total)}%`, color: "#ff3b5c" },
  ];
  return (
    <div className="panel flex items-stretch divide-x divide-white/[0.07] overflow-visible">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-1 flex-col gap-0.5 px-5 py-3">
          <span className="mono text-[10px] tracking-[0.16em] text-ink-500">{s.label}</span>
          <span className="mono text-2xl font-semibold" style={{ color: s.color }}>
            {s.value}
          </span>
        </div>
      ))}
      <RunProof institution={institution} />
    </div>
  );
}

const SLOT_ICON: Record<string, string> = {
  close_invoice: "✓",
  rfi: "?",
  mule: "⚠",
  held_fx: "⏸",
  tm22: "⌖",
};

export default function QueueClient({
  manifest,
  demo,
}: {
  manifest: Manifest | null;
  demo: Demo | null;
}) {
  const router = useRouter();
  const institutions = useMemo(() => manifest?.institutions ?? [], [manifest]);
  const hasDemo = !!demo?.picks?.length;
  const [tab, setTab] = useState(hasDemo ? DEMO_TAB : (institutions[0]?.id ?? ""));
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [help, setHelp] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const lastInstRef = useRef(institutions[0]?.id ?? "bank");

  // tab ids in display order: demo first, then institutions
  const tabIds = useMemo(
    () => [...(hasDemo ? [DEMO_TAB] : []), ...institutions.map((i) => i.id)],
    [hasDemo, institutions]
  );
  const instForProof = tab === DEMO_TAB ? lastInstRef.current : tab;

  useEffect(() => {
    if (tab !== DEMO_TAB && tab) lastInstRef.current = tab;
  }, [tab]);

  // traces load lazily per institution tab — the initial payload stays light
  // (manifest + demo.json only) so hydration and shortcuts are instant.
  const [traces, setTraces] = useState<Record<string, Trace[]>>({});
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (tab === DEMO_TAB || !tab || traces[tab]) return;
    let dead = false;
    setLoading(true);
    fetch(`/data/${tab}.json`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Trace[]) => {
        if (dead) return;
        setTraces((m) => ({ ...m, [tab]: data }));
        setLoading(false);
      })
      .catch(() => !dead && setLoading(false));
    return () => {
      dead = true;
    };
  }, [tab, traces]);

  const rows = useMemo(() => {
    if (tab === DEMO_TAB) return [];
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

  const shown = rows.slice(0, PAGE_SIZE);
  const picks = useMemo(() => demo?.picks ?? [], [demo]);

  useEffect(() => setCursor(0), [tab, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") {
        if (e.key === "Escape") (e.target as HTMLElement).blur();
        return;
      }
      if (e.key === "?") {
        setHelp((h) => !h);
        return;
      }
      if (help) {
        if (e.key === "Escape") setHelp(false);
        return;
      }
      if (e.key === "j") setCursor((c) => Math.min(c + 1, (tab === DEMO_TAB ? picks.length : shown.length) - 1));
      else if (e.key === "k") setCursor((c) => Math.max(c - 1, 0));
      else if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "Enter") {
        const id =
          tab === DEMO_TAB ? picks[cursor]?.case_id : shown[cursor]?.case_id;
        if (id) router.push(`/case/${id}`);
      } else if (/^[1-9]$/.test(e.key) && tabIds[+e.key - 1]) {
        setTab(tabIds[+e.key - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown, picks, cursor, router, tabIds, tab, help]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${cursor}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

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
      <ProofBar manifest={manifest} institution={instForProof} />

      {/* tabs: Demo first, then institutions */}
      <div className="flex items-center gap-2">
        {hasDemo && (
          <button
            onClick={() => setTab(DEMO_TAB)}
            className={`panel panel-hover relative flex items-center gap-3 px-4 py-2.5 text-left ${
              tab === DEMO_TAB ? "!border-[#37e0d855]" : ""
            }`}
            style={
              tab === DEMO_TAB ? { background: "rgba(55,224,216,0.05)" } : undefined
            }
          >
            <span className="mono text-[10px] text-ink-600">1</span>
            <span className="flex flex-col">
              <span
                className={`text-[13px] font-medium ${
                  tab === DEMO_TAB ? "text-ink-100" : "text-ink-300"
                }`}
              >
                ★ Demo
              </span>
              <span className="mono text-[10px] text-ink-500">
                {demo!.picks.length} showcase cases
              </span>
            </span>
            {tab === DEMO_TAB && (
              <motion.span
                layoutId="tab-glow"
                className="absolute inset-x-3 -bottom-px h-px"
                style={{
                  background: "linear-gradient(90deg, transparent, #37e0d8, transparent)",
                }}
              />
            )}
          </button>
        )}
        {institutions.map((inst, i) => {
          const active = inst.id === tab;
          const counts = inst.verdicts ?? ({} as Record<Verdict, number>);
          return (
            <button
              key={inst.id}
              onClick={() => setTab(inst.id)}
              className={`panel panel-hover relative flex items-center gap-3 px-4 py-2.5 text-left ${
                active ? "!border-[#37e0d855]" : ""
              }`}
              style={active ? { background: "rgba(55,224,216,0.05)" } : undefined}
            >
              <span className="mono text-[10px] text-ink-600">{i + (hasDemo ? 2 : 1)}</span>
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
          {tab !== DEMO_TAB && (
            <div className="relative">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search cases, customers, counterparties…"
                className="mono w-[300px] rounded-lg border border-white/10 bg-white/[0.03] py-2 pl-3 pr-8 text-[12px] text-ink-100 outline-none placeholder:text-ink-600 focus:border-[#37e0d860]"
              />
              <span className="kbd absolute right-2.5 top-1/2 -translate-y-1/2">/</span>
            </div>
          )}
          <button
            onClick={() => setHelp(true)}
            className="kbd px-1.5 py-1"
            title="Keyboard shortcuts"
          >
            ?
          </button>
          <span className="mono hidden items-center gap-1.5 text-[10px] text-ink-600 lg:flex">
            <span className="kbd">j</span>
            <span className="kbd">k</span> navigate
            <span className="kbd">↵</span> open
          </span>
        </div>
      </div>

      {/* demo picks */}
      {tab === DEMO_TAB ? (
        <div className="grid flex-1 grid-cols-1 gap-3 pb-8 md:grid-cols-2 xl:grid-cols-3">
          {picks.map((pick, i) => {
            const selected = i === cursor;
            return (
              <motion.button
                key={pick.case_id}
                data-idx={i}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: i * 0.06 }}
                onClick={() => router.push(`/case/${pick.case_id}`)}
                onMouseEnter={() => setCursor(i)}
                className={`panel panel-hover group flex flex-col gap-3 p-4 text-left ${
                  selected ? "!border-[#37e0d845]" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="mono flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.14em] text-accent">
                    <span>{SLOT_ICON[pick.slot] ?? "◆"}</span>
                    {pick.label.toUpperCase()}
                  </span>
                  <VerdictPill verdict={pick.verdict} size="sm" />
                </div>
                <p className="text-[12.5px] leading-snug text-ink-300">{pick.blurb}</p>
                <div className="mt-auto flex items-end justify-between gap-2 border-t border-white/[0.06] pt-3">
                  <div className="min-w-0">
                    <div className="mono truncate text-[13px] font-semibold text-ink-100">
                      {pick.case_id}
                    </div>
                    <div className="truncate text-[11px] text-ink-500">
                      {pick.customer_name} · {INSTITUTION_LABEL[pick.institution] ?? pick.institution}
                    </div>
                  </div>
                  <div className="mono shrink-0 text-right text-[10px] leading-relaxed text-ink-500">
                    <div>{gbpShort(pick.flagged_gbp)} flagged</div>
                    <div>
                      {pick.txns} txns · {pick.counterparties} parties
                      {pick.unexplained ? ` · ${pick.unexplained}?` : ""}
                      {pick.has_flip ? " · ⤨ flip" : ""}
                    </div>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      ) : (
        /* queue */
        <div ref={listRef} className="flex flex-col gap-2 pb-8">
          <AnimatePresence mode="popLayout">
            {shown.map((t, i) => {
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
                  transition={{ duration: 0.15, delay: Math.min(i * 0.012, 0.25) }}
                  onClick={() => router.push(`/case/${t.case_id}`)}
                  onMouseEnter={() => setCursor(i)}
                  className={`panel panel-hover group flex items-center gap-4 px-4 py-3 text-left ${
                    selected ? "!border-[#37e0d845]" : ""
                  }`}
                >
                  <span
                    className="mono w-5 text-right text-[11px]"
                    style={{ color: selected ? "#37e0d8" : "#5f6b7e" }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex w-[210px] flex-col">
                    <span className="mono text-[12.5px] font-medium text-ink-100">{t.case_id}</span>
                    <span className="truncate text-[11.5px] text-ink-500">{t.customer.name}</span>
                  </div>
                  <div className="flex flex-1 flex-wrap items-center gap-1.5">
                    {t.customer.held_payment_id && (
                      <span
                        className="mono rounded-md border border-[#ffb02055] bg-[#ffb02012] px-1.5 py-0.5 text-[10px] font-semibold text-rfi"
                        title="An outgoing payment is held until this case is decided"
                      >
                        ⏸ HELD
                      </span>
                    )}
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
          {rows.length === 0 && loading && (
            <div className="flex flex-col gap-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="panel h-[62px] animate-pulse"
                  style={{ animationDelay: `${i * 0.08}s` }}
                />
              ))}
            </div>
          )}
          {rows.length === 0 && !loading && (
            <div className="panel p-10 text-center">
              <p className="mono text-[11px] tracking-[0.2em] text-ink-500">EMPTY</p>
              <p className="mt-2 text-sm text-ink-300">No cases match “{query}”.</p>
            </div>
          )}
          {rows.length > PAGE_SIZE && (
            <p className="mono px-1 pt-1 text-[10px] tracking-wider text-ink-600">
              SHOWING {PAGE_SIZE} OF {rows.length.toLocaleString()} — press{" "}
              <span className="kbd">/</span> to search
            </p>
          )}
        </div>
      )}

      <ShortcutHelp open={help} onClose={() => setHelp(false)} page="queue" />
    </div>
  );
}
