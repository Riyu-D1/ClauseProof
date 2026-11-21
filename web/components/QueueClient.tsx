"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import RunProof from "@/components/RunProof";
import ShortcutHelp from "@/components/ShortcutHelp";
import VerdictPill from "@/components/VerdictPill";
import { VERDICT_COLOR, gbpShort } from "@/lib/format";
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
  return (
    <div className="panel flex items-stretch">
      {/* primary: the one number that matters */}
      <div className="flex flex-col justify-center gap-1 border-r border-line px-6 py-4">
        <span className="label">Cases triaged</span>
        <span className="doto text-[42px] leading-none text-ink-100">
          {total.toLocaleString("en-GB")}
        </span>
      </div>
      {/* secondary: segmented verdict bar + readouts */}
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-2.5 border-r border-line px-6 py-4">
        <div className="flex items-baseline justify-between gap-6">
          {VERDICTS.map((v) => (
            <div key={v} className="flex items-baseline gap-2">
              <span className="label">{v === "CLOSE" ? "Closed" : v === "RFI" ? "RFI" : "Escalated"}</span>
              <span
                className="mono text-[15px] font-bold"
                style={{ color: VERDICT_COLOR[v] }}
              >
                {total ? Math.round((counts[v] / total) * 100) : 0}%
              </span>
            </div>
          ))}
        </div>
        <div className="flex h-[10px] w-full gap-[2px]" role="img"
          aria-label={`verdict split — close ${counts.CLOSE}, rfi ${counts.RFI}, escalate ${counts.ESCALATE} of ${total}`}
        >
          {VERDICTS.map((v) => (
            <div
              key={v}
              className="h-full"
              style={{
                flex: `${counts[v]} 1 0`,
                background: VERDICT_COLOR[v],
              }}
            />
          ))}
        </div>
        <div className="flex justify-between">
          {VERDICTS.map((v) => (
            <span key={v} className="mono text-[10px] text-ink-500">
              {counts[v].toLocaleString("en-GB")}
            </span>
          ))}
        </div>
      </div>
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
  const [verdictFilter, setVerdictFilter] = useState<Verdict | null>(null);
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
    let all = traces[tab] ?? [];
    if (verdictFilter) all = all.filter((t) => t.verdict === verdictFilter);
    if (!q) return all;
    return all.filter(
      (t) =>
        t.case_id.toLowerCase().includes(q) ||
        t.customer.name.toLowerCase().includes(q) ||
        t.coverage.some((c) => c.counterparty.toLowerCase().includes(q)) ||
        t.reason_code.toLowerCase().includes(q)
    );
  }, [traces, tab, query, verdictFilter]);

  const verdictCounts = useMemo(() => {
    const m: Record<Verdict, number> = { CLOSE: 0, RFI: 0, ESCALATE: 0 };
    for (const t of traces[tab] ?? []) m[t.verdict] += 1;
    return m;
  }, [traces, tab]);

  const shown = rows.slice(0, PAGE_SIZE);
  const picks = useMemo(() => demo?.picks ?? [], [demo]);

  useEffect(() => setCursor(0), [tab, query, verdictFilter]);

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
          <p className="mono text-[11px] tracking-[0.2em] text-ink-500">[ NO DATA ]</p>
          <h2 className="mt-2 text-lg font-semibold text-ink-100">No traces loaded yet</h2>
          <p className="mt-2 text-sm text-ink-300">
            Run <code className="mono text-accent">node scripts/import-traces.mjs</code> to
            import engine traces or generate fixture data.
          </p>
        </div>
      </div>
    );
  }

  const segBtn = (id: string, label: React.ReactNode, sub?: React.ReactNode) => {
    const active = tab === id;
    const idx = tabIds.indexOf(id);
    return (
      <button
        key={id}
        onClick={() => setTab(id)}
        className={`flex items-baseline gap-2 px-4 py-2.5 text-left transition-colors duration-150 ${
          active ? "bg-ink-100 text-obsidian-950" : "text-ink-400 hover:text-ink-100"
        }`}
      >
        <span className="mono text-[11px] font-bold tracking-[0.1em]">
          <span className={active ? "opacity-50" : "text-ink-600"}>{idx + 1} </span>
          {label}
        </span>
        {sub && (
          <span className={`mono text-[9.5px] ${active ? "text-obsidian-950/70" : "text-ink-500"}`}>
            {sub}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <ProofBar manifest={manifest} institution={instForProof} />

      {/* tabs: Nothing segmented control — active = inverted */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center overflow-hidden rounded-lg border border-line-2">
          {hasDemo && segBtn(DEMO_TAB, "DEMO", `${demo!.picks.length} picks`)}
          {institutions.map((inst) =>
            segBtn(
              inst.id,
              (INSTITUTION_LABEL[inst.id] ?? inst.id).toUpperCase(),
              `${inst.cases.toLocaleString("en-GB")}`
            )
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {tab !== DEMO_TAB && (
            <div className="hidden items-center overflow-hidden rounded-md border border-line-2 md:flex" role="group" aria-label="Filter by verdict">
              <button
                onClick={() => setVerdictFilter(null)}
                className={`mono px-2.5 py-1.5 text-[9.5px] font-bold tracking-[0.1em] transition-colors ${
                  verdictFilter === null ? "bg-ink-100 text-obsidian-950" : "text-ink-500 hover:text-ink-100"
                }`}
              >
                ALL
              </button>
              {VERDICTS.map((v) => (
                <button
                  key={v}
                  onClick={() => setVerdictFilter(verdictFilter === v ? null : v)}
                  className={`mono px-2.5 py-1.5 text-[9.5px] font-bold tracking-[0.1em] transition-colors ${
                    verdictFilter === v ? "bg-ink-100 text-obsidian-950" : "text-ink-500 hover:text-ink-100"
                  }`}
                  style={verdictFilter === v ? undefined : { color: `${VERDICT_COLOR[v]}99` }}
                >
                  {v} {verdictCounts[v].toLocaleString("en-GB")}
                </button>
              ))}
            </div>
          )}
          {tab !== DEMO_TAB && (
            <div className="relative">
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="SEARCH CASES, CUSTOMERS, PARTIES…"
                className="mono w-[300px] rounded-md border border-line bg-obsidian-850 py-2 pl-3 pr-8 text-[11px] tracking-wide text-ink-100 outline-none placeholder:text-ink-600 focus:border-accent"
              />
              <span className="kbd absolute right-2.5 top-1/2 -translate-y-1/2">/</span>
            </div>
          )}
          <button
            onClick={() => setHelp(true)}
            className="mono rounded-md border border-line px-2.5 py-1.5 text-[11px] text-ink-400 transition-colors hover:border-line-2 hover:text-ink-100"
            title="Keyboard shortcuts"
          >
            [ ? ]
          </button>
          <span className="mono hidden items-center gap-1.5 text-[10px] text-ink-500 lg:flex">
            <span className="kbd">j</span>
            <span className="kbd">k</span> navigate
            <span className="kbd">↵</span> open
          </span>
        </div>
      </div>

      {/* demo picks */}
      {tab === DEMO_TAB ? (
        <div className="grid flex-1 grid-cols-1 content-start gap-3 pb-8 md:grid-cols-2 xl:grid-cols-3">
          {picks.map((pick, i) => {
            const selected = i === cursor;
            return (
              <motion.button
                key={pick.case_id}
                data-idx={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: i * 0.05 }}
                onClick={() => router.push(`/case/${pick.case_id}`)}
                onMouseEnter={() => setCursor(i)}
                className={`panel panel-hover group relative flex flex-col gap-3 p-5 text-left ${
                  selected ? "border-accent" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="mono text-[10px] font-bold tracking-[0.16em] text-ink-400">
                    {SLOT_ICON[pick.slot] ?? "·"} {pick.label.toUpperCase()}
                  </span>
                  <VerdictPill verdict={pick.verdict} size="sm" />
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="doto text-[30px] leading-none text-ink-100">
                    {gbpShort(pick.flagged_gbp)}
                  </span>
                  <span className="label">flagged</span>
                </div>
                <p className="text-[13px] leading-snug text-ink-300">{pick.blurb}</p>
                <div className="mt-auto flex items-end justify-between gap-2 border-t border-line pt-3">
                  <div className="min-w-0">
                    <div className="mono truncate text-[12.5px] font-bold text-ink-100">
                      {pick.case_id}
                    </div>
                    <div className="truncate text-[11px] text-ink-400">
                      {pick.customer_name} · {INSTITUTION_LABEL[pick.institution] ?? pick.institution}
                    </div>
                  </div>
                  <div className="mono shrink-0 text-right text-[10px] leading-relaxed text-ink-500">
                    <div>
                      {pick.txns} txns · {pick.counterparties} parties
                      {pick.unexplained ? ` · ${pick.unexplained}?` : ""}
                      {pick.has_flip ? " · flip" : ""}
                    </div>
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      ) : (
        /* queue — one surface, hairline rows, cursor = left accent bar */
        <div ref={listRef} className="panel flex flex-col divide-y divide-line overflow-hidden">
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
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.12 }}
                  onClick={() => router.push(`/case/${t.case_id}`)}
                  onMouseEnter={() => setCursor(i)}
                  className={`group flex items-center gap-5 px-4 py-3 text-left transition-colors ${
                    selected ? "bg-obsidian-800" : "hover:bg-obsidian-800/60"
                  }`}
                  style={
                    selected
                      ? { boxShadow: "inset 2px 0 0 var(--color-accent)" }
                      : undefined
                  }
                >
                  <span
                    className={`mono w-6 text-right text-[11px] ${
                      selected ? "text-accent" : "text-ink-600"
                    }`}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="flex w-[220px] flex-col">
                    <span className="mono text-[12.5px] font-bold text-ink-100">{t.case_id}</span>
                    <span className="truncate text-[11.5px] text-ink-400">{t.customer.name}</span>
                  </div>
                  <div className="flex flex-1 flex-wrap items-center gap-1.5">
                    {t.customer.held_payment_id && (
                      <span
                        className="mono rounded border border-[#ffb22455] px-1.5 py-0.5 text-[9.5px] font-bold tracking-wider text-rfi"
                        title="An outgoing payment is held until this case is decided"
                      >
                        HELD
                      </span>
                    )}
                    {t.alerts.slice(0, 3).map((a) => (
                      <span
                        key={a.alert_id}
                        title={a.message}
                        className="mono rounded border border-line bg-obsidian-800 px-1.5 py-0.5 text-[10px] text-ink-300"
                      >
                        {a.rule_id} · {a.rule_name.split(" ").slice(0, 3).join(" ")}
                      </span>
                    ))}
                    {t.alerts.length > 3 && (
                      <span className="mono text-[10px] text-ink-500">+{t.alerts.length - 3}</span>
                    )}
                  </div>
                  <div className="hidden w-[140px] flex-col items-end md:flex">
                    <span className="mono text-[12.5px] text-ink-100">{gbpShort(flagged)}</span>
                    <span
                      className="mono text-[10px]"
                      style={{ color: uncovered ? "#ff5566" : "#7c8490" }}
                    >
                      {uncovered ? `${uncovered} unexplained` : "all explained"}
                    </span>
                  </div>
                  <VerdictPill verdict={t.verdict} />
                  <span className="text-ink-600 transition-colors group-hover:text-accent">
                    →
                  </span>
                </motion.button>
              );
            })}
          </AnimatePresence>
          {rows.length === 0 && loading && (
            <p className="mono px-5 py-10 text-[11px] tracking-[0.18em] text-ink-500">
              <span className="cp-dots">[ LOADING TRACES</span>
              <span> ]</span>
            </p>
          )}
          {rows.length === 0 && !loading && (
            <p className="mono px-5 py-10 text-[11px] tracking-[0.18em] text-ink-500">
              [ EMPTY — no cases match “{query}” ]
            </p>
          )}
          {rows.length > PAGE_SIZE && (
            <p className="mono border-t border-line px-4 py-2.5 text-[10px] tracking-[0.14em] text-ink-500">
              SHOWING {PAGE_SIZE} OF {rows.length.toLocaleString()} — press{" "}
              <span className="kbd">/</span> to search
            </p>
          )}
        </div>
      )}

      <ShortcutHelp open={help} onClose={() => setHelp(false)} />
    </div>
  );
}
