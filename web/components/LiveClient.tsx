"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import DecisionPath from "@/components/DecisionPath";
import FlowGraph from "@/components/FlowGraph";
import VerdictPill from "@/components/VerdictPill";
import { VERDICT_COLOR } from "@/lib/format";
import { INSTITUTION_LABEL, type Verdict } from "@/lib/types";
import {
  EXAMPLE_PROMPTS,
  ROTATING_PLACEHOLDERS,
  newDocId,
  newPayId,
  parseScenarioLocal,
  type LiveChannel,
  type LiveDoc,
  type LiveDocType,
  type LiveInstitution,
  type LivePayment,
  type LiveScenario,
  type ParseOutcome,
} from "@/lib/live-scenario";
import { suggestFlips } from "@/lib/live-flips";
import type { LiveResult } from "@/lib/live-run";
import { LivePreview, TemplateBuilder } from "@/components/LiveTemplate";

type ParserTag = "local" | "grok" | "openai";

const PARSER_LABEL: Record<ParserTag, string> = {
  local: "parsed locally",
  grok: "parsed by Grok",
  openai: "parsed by OpenAI",
};

const INSTITUTIONS: LiveInstitution[] = ["bank", "emoney", "investment", "payments_fx"];

const CHANNEL_LABEL: Record<LiveChannel, string> = {
  bank_transfer: "bank transfer",
  cash: "cash",
  card: "card spend",
  fund_buy: "buy fund units",
  fund_sell: "sell fund units",
  crypto: "crypto transfer",
};

const DOC_LABEL: Record<LiveDocType, string> = {
  invoice: "invoice",
  contract: "contract",
  receivable: "sales invoice issued",
  employment: "employment contract / payslip",
  bank_statement: "bank statement (own account)",
  gift_letter: "gift letter",
  loan_agreement: "loan agreement",
  cash_records: "cash takings records",
  event_letter: "solicitor / event letter",
  register: "company register extract",
};

const INPUT =
  "mono w-full rounded-md border border-line bg-obsidian-900 px-2 py-1 text-[11px] text-ink-100 outline-none placeholder:text-ink-600 focus:border-accent/60";
const CHIP =
  "mono shrink-0 rounded-full border border-line px-3 py-1 text-[10.5px] text-ink-300 transition-colors hover:border-accent/60 hover:text-accent";
const TINY_BTN =
  "mono rounded border border-line px-1.5 py-0.5 text-[9px] text-ink-500 transition-colors hover:border-escalate/60 hover:text-escalate";

function verdictOf(r: LiveResult | null): Verdict | "NO_ALERT" | null {
  if (!r) return null;
  return r.verdict === "NO_ALERT" ? "NO_ALERT" : (r.verdict as Verdict);
}

export default function LiveClient({
  llmTag = null,
}: {
  /** which LLM the parse toggle offers — null hides the switch entirely */
  llmTag?: "grok" | "openai" | null;
}) {
  const [text, setText] = useState("");
  const [phIdx, setPhIdx] = useState(0);
  const [scenario, setScenario] = useState<LiveScenario | null>(null);
  const [parser, setParser] = useState<ParserTag | null>(null);
  const [parseMs, setParseMs] = useState<number | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [result, setResult] = useState<LiveResult | null>(null);
  const [prevVerdict, setPrevVerdict] = useState<string | null>(null);
  const [running, setRunning] = useState<"parse" | "run" | null>(null);
  const [runMs, setRunMs] = useState<number | null>(null);
  const [runId, setRunId] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [instLocked, setInstLocked] = useState(false);
  const [useLlm, setUseLlm] = useState(true);
  /** card edited since the last run — edits never fire a run themselves */
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<ParseOutcome | null>(null);
  /** the text the current scenario was parsed from */
  const [ranText, setRanText] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // rotating placeholder
  useEffect(() => {
    const t = setInterval(
      () => setPhIdx((i) => (i + 1) % ROTATING_PLACEHOLDERS.length),
      4200
    );
    return () => clearInterval(t);
  }, []);

  // One engine run = one POST, and only ever from an explicit user action:
  // the Run button, an example chip, a flip chip, or the card's RE-RUN.
  const runScenario = useCallback(async (s: LiveScenario) => {
    setRunning("run");
    setError(null);
    const t0 = performance.now();
    try {
      const res = await fetch("/api/live", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "run", scenario: s }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "run failed");
      setScenario(data.scenario);
      setDirty(false);
      setResult((prev) => {
        if (prev && prev.verdict !== data.result.verdict) {
          setPrevVerdict(prev.verdict);
        } else {
          setPrevVerdict(null);
        }
        return data.result;
      });
      setRunMs(Math.round(performance.now() - t0));
      setRunId((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "engine failed");
    } finally {
      setRunning(null);
    }
  }, []);

  const parseAndRun = useCallback(
    async (input: string) => {
      setRunning("parse");
      setError(null);
      const t0 = performance.now();
      try {
        const res = await fetch("/api/live", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: "go", text: input, useLlm }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "failed");
        setScenario(data.scenario);
        setParser(data.parser as ParserTag);
        setParseMs(typeof data.parseMs === "number" ? data.parseMs : null);
        setNotes(data.notes ?? []);
        setInstLocked(false);
        setDirty(false);
        setRanText(input);
        setResult((prev) => {
          if (prev && prev.verdict !== data.result.verdict) {
            setPrevVerdict(prev.verdict);
          } else {
            setPrevVerdict(null);
          }
          return data.result;
        });
        setRunMs(Math.round(performance.now() - t0));
        setRunId((n) => n + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : "failed");
      } finally {
        setRunning(null);
      }
    },
    [useLlm]
  );

  // "what I understood" preview — debounced LOCAL parse of the text box.
  // Pure client-side: no fetch, no engine run, ever.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = text.trim();
    if (q.length < 12 || q === ranText) {
      setPreview(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      setPreview(parseScenarioLocal(q));
    }, 450);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [text, ranText]);

  const edit = useCallback((fn: (s: LiveScenario) => LiveScenario) => {
    setDirty(true);
    setScenario((s) => (s ? fn(s) : s));
  }, []);

  const verdict = verdictOf(result);
  const vc = verdict && verdict !== "NO_ALERT" ? VERDICT_COLOR[verdict] : "#7c8490";
  const flips = scenario && result ? suggestFlips(scenario, result) : [];
  const engineMs = result?.ms ?? null;

  /* ------------------------------ field edits ----------------------------- */

  const setPay = (id: string, patch: Partial<LivePayment>) =>
    edit((s) => ({
      ...s,
      payments: s.payments.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  const setDocField = (id: string, patch: Partial<LiveDoc>) =>
    edit((s) => ({
      ...s,
      docs: s.docs.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    }));

  return (
    <div className="flex flex-1 flex-col gap-4 px-6 pb-8 pt-4">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="doto text-[26px] leading-none text-ink-100">TRY IT LIVE</h1>
          <p className="mono mt-2 text-[10.5px] uppercase tracking-[0.2em] text-ink-500">
            type anything · the real engine decides · nothing is preset
          </p>
        </div>
        <div className="mono flex items-center gap-3 text-[10px] text-ink-500">
          {parser && (
            <span className="rounded border border-line-2 bg-obsidian-800 px-2 py-1 tracking-[0.12em] text-ink-300">
              {PARSER_LABEL[parser].toUpperCase()}
              {parseMs != null && ` · ${parseMs}MS`}
            </span>
          )}
          <span className="rounded border border-accent/40 bg-obsidian-800 px-2 py-1 tracking-[0.12em] text-accent">
            VERDICT: DETERMINISTIC ENGINE
          </span>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[460px_minmax(0,1fr)]">
        {/* ------------------------------ left ------------------------------ */}
        <div className="flex flex-col gap-4">
          {/* input */}
          <div className="panel p-4">
            <label className="label" htmlFor="live-text">
              Describe any customer and what their money did
            </label>
            <textarea
              id="live-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (text.trim() && !running) void parseAndRun(text.trim());
                }
              }}
              rows={4}
              placeholder={ROTATING_PLACEHOLDERS[phIdx]}
              className={`${INPUT} mt-3 resize-none !text-[13px] leading-relaxed`}
            />
            <div className="mt-3 flex items-center justify-between gap-2">
              <div className="flex flex-col gap-1">
                <span className="mono text-[9.5px] text-ink-600">
                  Enter ↵ to run · Shift+Enter for a new line
                </span>
                {llmTag && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={useLlm}
                    onClick={() => setUseLlm((v) => !v)}
                    className="mono flex items-center gap-1.5 text-[9.5px] text-ink-400 transition-colors hover:text-ink-200"
                    title={
                      useLlm
                        ? `free text is parsed by ${llmTag === "grok" ? "Grok" : "OpenAI"} (server-side key, never shown)`
                        : "free text is parsed by the deterministic local parser"
                    }
                  >
                    <span
                      className={`relative inline-block h-[14px] w-[26px] shrink-0 rounded-full border transition-colors ${
                        useLlm
                          ? "border-accent bg-accent/30"
                          : "border-line-2 bg-obsidian-900"
                      }`}
                    >
                      <span
                        className={`absolute top-[1px] h-[10px] w-[10px] rounded-full transition-all ${
                          useLlm ? "left-[13px] bg-accent" : "left-[2px] bg-ink-500"
                        }`}
                      />
                    </span>
                    PARSE WITH {llmTag === "grok" ? "GROK" : "OPENAI"}
                  </button>
                )}
              </div>
              <button
                onClick={() => text.trim() && void parseAndRun(text.trim())}
                disabled={!text.trim() || !!running}
                className="mono rounded-md border border-accent bg-accent px-4 py-1.5 text-[11px] font-bold tracking-[0.14em] text-obsidian-950 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {running === "parse" ? "PARSING…" : running === "run" ? "RUNNING…" : "RUN THE ENGINE →"}
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {EXAMPLE_PROMPTS.map((e) => (
                <button
                  key={e.label}
                  className={CHIP}
                  title={e.text}
                  onClick={() => {
                    setText(e.text);
                    void parseAndRun(e.text);
                  }}
                >
                  {e.label}
                </button>
              ))}
            </div>
            <TemplateBuilder onInsert={(t) => setText(t)} />
            {preview && <LivePreview outcome={preview} />}
            <p className="mt-3 text-[11px] leading-relaxed text-ink-500">
              Parsing only fills the editable card below — the verdict always comes
              from the deterministic engine, the same one that scored the 4,000
              development cases.
            </p>
            {notes.map((n, i) => (
              <p key={i} className="mt-1 text-[11px] italic leading-snug text-rfi">
                {n}
              </p>
            ))}
          </div>

          {/* scenario card */}
          {scenario && (
            <div className="panel p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="label">Scenario card — edit anything</span>
                <div className="flex items-center gap-2">
                  {dirty && (
                    <span className="mono text-[9px] text-rfi">edited — verdict is stale</span>
                  )}
                  <button
                    onClick={() => void runScenario(scenario)}
                    disabled={!!running}
                    className={`mono rounded border px-2 py-0.5 text-[9px] tracking-[0.08em] transition-colors disabled:opacity-40 ${
                      dirty
                        ? "border-accent bg-accent/15 text-accent hover:bg-accent/25"
                        : "border-line text-ink-400 hover:border-line-2"
                    }`}
                  >
                    {running === "run" ? "RUNNING…" : "RE-RUN ENGINE →"}
                  </button>
                </div>
              </div>

              {/* institution */}
              <div className="mb-3">
                <div className="mono mb-1.5 text-[9.5px] uppercase tracking-[0.14em] text-ink-500">
                  Institution {scenario.institutionAuto && !instLocked && (
                    <span className="text-accent/80">· auto-picked</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {INSTITUTIONS.map((i) => (
                    <button
                      key={i}
                      onClick={() => {
                        setInstLocked(true);
                        edit((s) => ({ ...s, institution: i, institutionAuto: false }));
                      }}
                      className={`mono rounded border px-2.5 py-1 text-[10px] tracking-[0.08em] transition-colors ${
                        scenario.institution === i
                          ? "border-accent bg-accent/10 text-accent"
                          : "border-line text-ink-400 hover:border-line-2"
                      }`}
                    >
                      {INSTITUTION_LABEL[i].toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* customer */}
              <div className="mb-3 grid grid-cols-2 gap-2">
                <div className="col-span-2 flex gap-2">
                  <select
                    value={scenario.customerKind}
                    onChange={(e) =>
                      edit((s) => ({
                        ...s,
                        customerKind: e.target.value as LiveScenario["customerKind"],
                      }))
                    }
                    className={INPUT}
                  >
                    <option value="individual">individual</option>
                    <option value="business">business</option>
                  </select>
                  <input
                    value={scenario.customerName}
                    onChange={(e) => edit((s) => ({ ...s, customerName: e.target.value }))}
                    className={INPUT}
                    placeholder="customer name"
                  />
                </div>
                <input
                  value={scenario.activity}
                  onChange={(e) => edit((s) => ({ ...s, activity: e.target.value }))}
                  className={`${INPUT} col-span-2`}
                  placeholder="occupation / business activity"
                />
                <label className="mono flex items-center gap-1.5 text-[10px] text-ink-500">
                  £/mo declared
                  <input
                    type="number"
                    value={scenario.monthlyGbp}
                    onChange={(e) =>
                      edit((s) => ({ ...s, monthlyGbp: Number(e.target.value) || 0 }))
                    }
                    className={`${INPUT} !w-24`}
                  />
                </label>
                <label className="mono flex items-center gap-1.5 text-[10px] text-ink-500">
                  employer
                  <input
                    value={scenario.employer ?? ""}
                    onChange={(e) =>
                      edit((s) => ({ ...s, employer: e.target.value || null }))
                    }
                    className={INPUT}
                    placeholder="—"
                  />
                </label>
                <label className="mono col-span-2 flex items-center gap-1.5 text-[10px] text-ink-500">
                  declared countries
                  <input
                    value={scenario.expectedCountries.join(", ")}
                    onChange={(e) =>
                      edit((s) => ({
                        ...s,
                        expectedCountries: e.target.value
                          .split(",")
                          .map((x) => x.trim())
                          .filter(Boolean),
                      }))
                    }
                    className={INPUT}
                  />
                </label>
              </div>

              {/* payments */}
              <div className="mb-1.5 flex items-center justify-between">
                <span className="mono text-[9.5px] uppercase tracking-[0.14em] text-ink-500">
                  Payments ({scenario.payments.length})
                </span>
                <button
                  className="mono text-[9.5px] text-accent hover:underline"
                  onClick={() =>
                    edit((s) => ({
                      ...s,
                      payments: [
                        ...s.payments,
                        {
                          id: newPayId(),
                          direction: "in",
                          amountGbp: 1000,
                          counterparty: "New Counterparty",
                          country: "United Kingdom",
                          channel: "bank_transfer",
                          day: 12,
                          hour: 9,
                          ownAccount: false,
                        },
                      ],
                    }))
                  }
                >
                  + add
                </button>
              </div>
              <div className="mb-3 flex max-h-[300px] flex-col gap-1.5 overflow-y-auto pr-1">
                {scenario.payments.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-1.5 rounded-md border border-line bg-obsidian-900 px-1.5 py-1"
                  >
                    <button
                      onClick={() =>
                        setPay(p.id, { direction: p.direction === "in" ? "out" : "in" })
                      }
                      className={`mono w-8 shrink-0 rounded border px-0.5 py-0.5 text-center text-[9px] font-bold ${
                        p.direction === "in"
                          ? "border-close/50 text-close"
                          : "border-escalate/50 text-escalate"
                      }`}
                      title="toggle direction"
                    >
                      {p.direction === "in" ? "IN" : "OUT"}
                    </button>
                    <input
                      type="number"
                      value={p.amountGbp}
                      onChange={(e) =>
                        setPay(p.id, { amountGbp: Number(e.target.value) || 0 })
                      }
                      className={`${INPUT} !w-[74px]`}
                      title="amount £"
                    />
                    <select
                      value={p.channel}
                      onChange={(e) =>
                        setPay(p.id, { channel: e.target.value as LiveChannel })
                      }
                      className={`${INPUT} !w-[96px]`}
                      title="method"
                    >
                      {Object.entries(CHANNEL_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                    <input
                      value={p.counterparty ?? ""}
                      onChange={(e) =>
                        setPay(p.id, { counterparty: e.target.value || null })
                      }
                      className={`${INPUT} min-w-0 flex-1`}
                      placeholder={p.channel === "cash" ? "cash" : "counterparty"}
                      title="counterparty"
                    />
                    <input
                      value={p.country}
                      onChange={(e) => setPay(p.id, { country: e.target.value })}
                      className={`${INPUT} !w-[92px]`}
                      title="country"
                    />
                    <input
                      type="number"
                      value={p.day}
                      min={1}
                      max={30}
                      onChange={(e) =>
                        setPay(p.id, { day: Math.min(30, Math.max(1, Number(e.target.value) || 1)) })
                      }
                      className={`${INPUT} !w-[44px]`}
                      title="day of month"
                    />
                    <input
                      type="number"
                      value={p.hour}
                      min={0}
                      max={23}
                      step={0.5}
                      onChange={(e) =>
                        setPay(p.id, { hour: Math.min(23.9, Math.max(0, Number(e.target.value) || 0)) })
                      }
                      className={`${INPUT} !w-[44px]`}
                      title="hour"
                    />
                    <button
                      className={TINY_BTN}
                      title="remove payment"
                      onClick={() =>
                        edit((s) => ({
                          ...s,
                          payments: s.payments.filter((x) => x.id !== p.id),
                        }))
                      }
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              {/* docs + flags */}
              <div className="mb-1.5 flex items-center justify-between">
                <span className="mono text-[9.5px] uppercase tracking-[0.14em] text-ink-500">
                  Documents on file ({scenario.docs.length})
                </span>
                <button
                  className="mono text-[9.5px] text-accent hover:underline"
                  onClick={() =>
                    edit((s) => ({
                      ...s,
                      docs: [
                        ...s.docs,
                        {
                          id: newDocId(),
                          type: "invoice",
                          partyName: null,
                          amountGbp: null,
                          matching: true,
                          linkedPaymentId: null,
                          partyDob: null,
                        },
                      ],
                    }))
                  }
                >
                  + add
                </button>
              </div>
              <div className="mb-3 flex flex-col gap-1.5">
                {scenario.docs.length === 0 && (
                  <div className="rounded-md border border-dashed border-line-2 px-2.5 py-2 text-[10.5px] text-ink-600">
                    nothing on file — the engine works it out anyway
                  </div>
                )}
                {scenario.docs.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center gap-1.5 rounded-md border border-line bg-obsidian-900 px-1.5 py-1"
                  >
                    <select
                      value={d.type}
                      onChange={(e) => setDocField(d.id, { type: e.target.value as LiveDocType })}
                      className={`${INPUT} !w-[150px]`}
                    >
                      {Object.entries(DOC_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>{l}</option>
                      ))}
                    </select>
                    <input
                      value={d.partyName ?? ""}
                      onChange={(e) => setDocField(d.id, { partyName: e.target.value || null })}
                      className={`${INPUT} min-w-0 flex-1`}
                      placeholder="party named in doc"
                    />
                    <input
                      type="number"
                      value={d.amountGbp ?? ""}
                      onChange={(e) =>
                        setDocField(d.id, {
                          amountGbp: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      className={`${INPUT} !w-[72px]`}
                      placeholder="£=linked"
                      title="amount (blank = same as linked payment)"
                    />
                    <button
                      onClick={() => setDocField(d.id, { matching: !d.matching })}
                      className={`mono shrink-0 rounded border px-1.5 py-0.5 text-[9px] ${
                        d.matching
                          ? "border-close/50 text-close"
                          : "border-escalate/50 text-escalate"
                      }`}
                      title="toggle whether the document amount matches"
                    >
                      {d.matching ? "MATCH" : "WRONG£"}
                    </button>
                    <button
                      className={TINY_BTN}
                      title="remove document"
                      onClick={() =>
                        edit((s) => ({ ...s, docs: s.docs.filter((x) => x.id !== d.id) }))
                      }
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {(
                  [
                    ["dormant", "dormant account (TM07)"],
                    ["listHit", "counterparty on internal list (TM22)"],
                    ["priorReview", "earlier review cleared same party"],
                  ] as const
                ).map(([key, lbl]) => {
                  const on =
                    key === "dormant"
                      ? scenario.dormant
                      : key === "listHit"
                        ? !!scenario.listHitCounterparty
                        : !!scenario.priorReviewCounterparty;
                  return (
                    <label
                      key={key}
                      className="mono flex cursor-pointer items-center gap-1.5 text-[10px] text-ink-400"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) =>
                          edit((s) => {
                            const cp =
                              s.payments.find((p) => p.counterparty && !p.ownAccount)
                                ?.counterparty ?? "Vernon Ashpole";
                            return {
                              ...s,
                              dormant: key === "dormant" ? e.target.checked : s.dormant,
                              listHitCounterparty:
                                key === "listHit"
                                  ? e.target.checked
                                    ? cp
                                    : null
                                  : s.listHitCounterparty,
                              priorReviewCounterparty:
                                key === "priorReview"
                                  ? e.target.checked
                                    ? cp
                                    : null
                                  : s.priorReviewCounterparty,
                            };
                          })
                        }
                        className="accent-[#41d8cf]"
                      />
                      {lbl}
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ------------------------------ right ------------------------------ */}
        <div className="flex min-w-0 flex-col gap-4">
          {!result && (
            <div className="panel flex flex-1 flex-col items-center justify-center gap-4 p-10 text-center">
              <div className="doto text-[30px] text-ink-600">?</div>
              <p className="max-w-[480px] text-[15px] leading-relaxed text-ink-300">
                Type a sentence — <span className="text-ink-100">who they are and what
                their money did</span> — and watch the real ClauseProof engine read
                the file, fire the monitoring rules, and decide:
                <span className="text-close"> CLOSE</span>,
                <span className="text-rfi"> RFI</span> or
                <span className="text-escalate"> ESCALATE</span>.
              </p>
              <p className="mono text-[10px] uppercase tracking-[0.18em] text-ink-500">
                or click an example on the left
              </p>
            </div>
          )}

          {result && (
            <>
              {/* verdict banner */}
              <div
                className="panel px-5 py-3.5"
                style={{ borderColor: `${vc}44` }}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-4">
                    {verdict === "NO_ALERT" ? (
                      <span className="doto text-[24px] leading-none text-ink-400">
                        NO ALERT
                      </span>
                    ) : (
                      verdict && <VerdictPill verdict={verdict} />
                    )}
                    {prevVerdict && prevVerdict !== verdict && (
                      <span className="mono text-[10px] text-ink-500">
                        was {prevVerdict} →
                      </span>
                    )}
                    {result.reason_code && (
                      <span className="mono rounded border border-line bg-obsidian-900 px-1.5 py-0.5 text-[9.5px] tracking-[0.08em] text-ink-300">
                        {result.reason_code}
                      </span>
                    )}
                  </div>
                  <div className="mono flex items-center gap-3 text-[10px] text-ink-500">
                    {engineMs != null && (
                      <span title="server-side build + engine time">
                        engine {engineMs}ms
                      </span>
                    )}
                    {runMs != null && (
                      <span title="end-to-end round trip">
                        round-trip {runMs}ms
                      </span>
                    )}
                    {running === "run" && <span className="cp-dots text-accent">running</span>}
                  </div>
                </div>
                <p className="mt-2 max-w-[760px] text-[13px] leading-relaxed text-ink-100">
                  {result.reason}
                </p>
                {result.context.length > 0 && (
                  <p className="mono mt-1.5 text-[10px] text-ink-500">
                    context noted: {result.context.join(" · ")}
                  </p>
                )}
              </div>

              {/* alerts fired */}
              <div className="panel px-4 py-3">
                <div className="label mb-2">
                  {result.alerts.length
                    ? `Monitoring rules that fired (${result.alerts.length})`
                    : "Monitoring rules"}
                </div>
                {result.alerts.length === 0 ? (
                  <p className="text-[12px] text-ink-400">
                    No alert — the bank&apos;s rules wouldn&apos;t have looked at
                    this file. There is no case to review; try the buttons below
                    to see what would have tripped them.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {result.alerts.map((a, i) => (
                      <div
                        key={i}
                        className="rounded-md border border-line bg-obsidian-900 px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="mono rounded border border-rfi/50 bg-rfi/10 px-1.5 py-0.5 text-[9px] font-bold text-rfi">
                            {a.rule_id}
                          </span>
                          <span className="text-[11.5px] font-semibold text-ink-100">
                            {a.rule_name}
                          </span>
                        </div>
                        <p className="mono mt-1 text-[10px] leading-relaxed text-ink-400">
                          {a.message}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* flip bar */}
              <div className="panel px-4 py-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="label">Flip it — one click, real re-run</span>
                  {result.trace?.flip && (
                    <span className="mono text-[9.5px] text-ink-500">
                      engine counterfactual: {result.trace.flip.change} →{" "}
                      {result.trace.flip.new_verdict}
                    </span>
                  )}
                </div>
                {flips.length === 0 ? (
                  <p className="text-[12px] text-ink-400">
                    No single change worth suggesting — edit the card directly.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {flips.map((f) => (
                      <button
                        key={f.id}
                        title={f.detail}
                        disabled={!!running}
                        onClick={() => {
                          if (!scenario) return;
                          const next = f.apply(scenario);
                          setScenario(next);
                          void runScenario(next);
                        }}
                        className={`${CHIP} !border-line-2 disabled:opacity-40`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* flow + path */}
              {result.trace && (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
                  <div className="panel h-[440px] overflow-hidden">
                    <FlowGraph
                      key={`flow-${runId}`}
                      trace={result.trace}
                      onDoc={(id) => setDoc(id)}
                      flipped={false}
                    />
                  </div>
                  <div className="panel h-[440px] overflow-y-auto p-4">
                    <DecisionPath
                      trace={result.trace}
                      runId={runId}
                      onDoc={(id) => setDoc(id)}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* doc viewer */}
      <AnimatePresence>
        {doc && result?.docTexts[doc] && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-obsidian-950/80 p-6"
            onClick={() => setDoc(null)}
          >
            <motion.div
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 16, opacity: 0 }}
              className="panel max-h-[80vh] w-full max-w-[560px] overflow-y-auto p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="label">Document {doc} — on file</span>
                <button className={TINY_BTN} onClick={() => setDoc(null)}>✕</button>
              </div>
              <div className="evidence-md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {result.docTexts[doc]}
                </ReactMarkdown>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-escalate/60 bg-obsidian-900 px-4 py-2 text-[12px] text-escalate">
          {error}
        </div>
      )}
    </div>
  );
}
