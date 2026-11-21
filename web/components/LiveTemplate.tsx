"use client";

// Input helpers for /live, used only by LiveClient:
//  - <TemplateBuilder>: the fill-in sentence. Each [part] is a chip you
//    click to pick an option or type your own; INSERT puts the composed
//    sentence in the text box (it never runs anything).
//  - <LivePreview>: the "what I understood" card — a debounced LOCAL
//    parse of the text. No engine run, no network.

import { useState } from "react";
import { gbp } from "@/lib/format";
import { INSTITUTION_LABEL } from "@/lib/types";
import type { LiveScenario, ParseOutcome } from "@/lib/live-scenario";

/* ------------------------------ template -------------------------------- */

interface SlotDef {
  key: string;
  label: string;
  options: string[];
  custom?: boolean;
  prefix?: string;
}

const SLOTS: SlotDef[] = [
  { key: "who", label: "job or business", options: ["student", "waiter", "café", "landlord", "cleaning company"], custom: true },
  { key: "earn", label: "£/mo", options: ["800", "2,500", "4,000", "20,000"], custom: true },
  { key: "recv", label: "amount", options: ["9,000", "12,000", "18,500", "25,000"], custom: true },
  { key: "num", label: "number", options: ["3", "5", "6", "8"], custom: true },
  { key: "rel", label: "from", options: ["strangers", "customers", "family", "different people"] },
  { key: "over", label: "time", options: ["a day", "a week", "two weeks", "a month"] },
  { key: "sent", label: "amount", options: ["9,000", "12,000", "18,500", "25,000"], custom: true },
  { key: "country", label: "country", options: ["United Arab Emirates", "Russia", "Spain", "Turkey", "Nigeria"], custom: true },
  { key: "later", label: "time", options: ["an hour", "a day", "a week"] },
  { key: "docs", label: "docs", options: ["invoice", "payslip", "contract", "bank statement", "none"] },
];

const DEFAULTS: Record<string, string> = Object.fromEntries(
  SLOTS.map((s) => [s.key, s.options[0]])
);

export function composeTemplate(v: Record<string, string>): string {
  return `A ${v.who} earning £${v.earn} a month receives £${v.recv} from ${v.num} ${v.rel} over ${v.over}, then sends £${v.sent} to ${v.country} ${v.later} later. Documents on file: ${v.docs}.`;
}

const SLOT_BTN =
  "mono mx-0.5 rounded border border-dashed border-accent/60 bg-accent/10 px-1.5 py-0 text-[10.5px] text-accent transition-colors hover:bg-accent/20";
const OPT_BTN =
  "mono rounded border border-line px-2 py-0.5 text-[10px] text-ink-300 transition-colors hover:border-accent/60 hover:text-accent";

export function TemplateBuilder({ onInsert }: { onInsert: (text: string) => void }) {
  const [vals, setVals] = useState<Record<string, string>>(DEFAULTS);
  const [open, setOpen] = useState<string | null>(null);
  const [custom, setCustom] = useState("");
  const [copied, setCopied] = useState(false);

  const slot = (key: string) => SLOTS.find((s) => s.key === key)!;
  const chip = (key: string, pre = "") => (
    <button
      key={key}
      type="button"
      className={SLOT_BTN}
      title={`${slot(key).label} — click to change`}
      onClick={() => {
        setOpen((o) => (o === key ? null : key));
        setCustom("");
      }}
    >
      [{pre}{vals[key] || slot(key).label}]
    </button>
  );

  const pick = (key: string, v: string) => {
    setVals((s) => ({ ...s, [key]: v }));
    setOpen(null);
    setCustom("");
  };

  const sentence = composeTemplate(vals);

  return (
    <div className="mt-3 rounded-md border border-line bg-obsidian-900/60 px-3 py-2.5">
      <div className="mono mb-1.5 text-[9px] uppercase tracking-[0.16em] text-ink-500">
        Not sure how to phrase it? Fill this in — click each [part]
      </div>
      <p className="text-[12.5px] leading-7 text-ink-200">
        A {chip("who")} earning £{chip("earn")} a month receives £{chip("recv")}{" "}
        from {chip("num")} {chip("rel")} over {chip("over")}, then sends £
        {chip("sent")} to {chip("country")} {chip("later")} later. Documents on
        file: {chip("docs")}.
      </p>

      {open && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded border border-line-2 bg-obsidian-950 px-2 py-1.5">
          <span className="mono text-[9px] uppercase tracking-[0.14em] text-ink-500">
            {slot(open).label}:
          </span>
          {slot(open).options.map((o) => (
            <button key={o} type="button" className={OPT_BTN} onClick={() => pick(open, o)}>
              {o}
            </button>
          ))}
          {slot(open).custom && (
            <input
              autoFocus
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && custom.trim()) pick(open, custom.trim());
                if (e.key === "Escape") setOpen(null);
              }}
              placeholder="or type… ↵"
              className="mono w-24 rounded border border-line bg-obsidian-900 px-1.5 py-0.5 text-[10px] text-ink-100 outline-none placeholder:text-ink-600 focus:border-accent/60"
            />
          )}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onInsert(sentence)}
          className="mono rounded border border-accent/70 bg-accent/15 px-2.5 py-1 text-[10px] font-bold tracking-[0.1em] text-accent transition-colors hover:bg-accent/25"
        >
          INSERT INTO BOX ↵
        </button>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard
              ?.writeText(sentence)
              .then(() => setCopied(true))
              .catch(() => {});
            setTimeout(() => setCopied(false), 1500);
          }}
          className="mono rounded border border-line px-2.5 py-1 text-[10px] text-ink-400 transition-colors hover:border-line-2 hover:text-ink-200"
        >
          {copied ? "COPIED ✓" : "COPY"}
        </button>
        <span className="mono text-[9px] text-ink-600">
          inserting never runs — Run is always your call
        </span>
      </div>
    </div>
  );
}

/* ------------------------------- preview -------------------------------- */

function PreviewPayment({ s }: { s: LiveScenario }) {
  const rows = s.payments.slice(0, 5);
  return (
    <div className="mt-1 flex flex-col gap-0.5">
      {rows.map((p) => (
        <div key={p.id} className="mono flex items-baseline gap-1.5 text-[10px]">
          <span className={p.direction === "in" ? "text-close" : "text-escalate"}>
            {p.direction === "in" ? "→ IN" : "OUT →"}
          </span>
          <span className="text-ink-100">{gbp(p.amountGbp, 0)}</span>
          <span className="truncate text-ink-400">
            {p.counterparty ?? "cash"} · {p.country}
            {p.channel !== "bank_transfer" ? ` · ${p.channel}` : ""}
            {p.ownAccount ? " · own acct" : ""} · day {p.day}
          </span>
        </div>
      ))}
      {s.payments.length > rows.length && (
        <div className="mono text-[9.5px] text-ink-500">
          +{s.payments.length - rows.length} more
        </div>
      )}
      {s.payments.length === 0 && (
        <div className="text-[10.5px] italic text-ink-500">no payments found</div>
      )}
    </div>
  );
}

/** "What I understood" — debounced local parse of the text box. Pure
 * client-side; never calls the API or the engine. */
export function LivePreview({ outcome }: { outcome: ParseOutcome }) {
  const s = outcome.scenario;
  const flags = [
    s.dormant ? "dormant" : null,
    s.listHitCounterparty ? `list hit: ${s.listHitCounterparty}` : null,
    s.priorReviewCounterparty ? `prior review: ${s.priorReviewCounterparty}` : null,
    ...s.contextFlags,
  ].filter(Boolean) as string[];
  return (
    <div className="mt-3 rounded-md border border-line-2/70 bg-obsidian-900/40 px-3 py-2.5">
      <div className="mono mb-1 flex items-center justify-between text-[9px] uppercase tracking-[0.16em] text-ink-500">
        <span>What I understood · preview</span>
        <span>local parser only{outcome.ms != null ? ` · ${outcome.ms}ms` : ""} · no engine run</span>
      </div>
      <div className="mono text-[10.5px] leading-relaxed text-ink-200">
        <span className="text-accent">{INSTITUTION_LABEL[s.institution]}</span>
        {" · "}
        {s.customerKind} · {s.customerName} · “{s.activity}” ·{" "}
        {gbp(s.monthlyGbp, 0)}/mo declared
      </div>
      <PreviewPayment s={s} />
      <div className="mono mt-1 text-[10px] text-ink-400">
        docs: {s.docs.length ? s.docs.map((d) => d.type.replace(/_/g, " ")).join(", ") : "none on file"}
        {flags.length ? `  ·  ${flags.join(" · ")}` : ""}
      </div>
      {outcome.notes.map((n, i) => (
        <p key={i} className="mt-1 text-[10.5px] italic leading-snug text-rfi">
          {n}
        </p>
      ))}
    </div>
  );
}
