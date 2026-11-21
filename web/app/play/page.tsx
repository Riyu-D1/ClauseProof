"use client";

import { useEffect, useMemo, useState } from "react";
import {
  GAME_TOTAL_GBP,
  PERSONAS,
  type DestDef,
  type InvoiceChoice,
  type Persona,
} from "@/lib/play";
import { gbp, gbpShort, VERDICT_COLOR } from "@/lib/format";
import VerdictPill from "@/components/VerdictPill";

/* ------------------------------- types ---------------------------------- */

interface PlayResult {
  bucket: "CAUGHT" | "QUESTIONED" | "GOT AWAY";
  verdict: "CLOSE" | "RFI" | "ESCALATE" | "NO_ALERT";
  reason_code: string | null;
  reason: string | null;
  alerts: { rule_id: string; rule_name: string; message: string }[];
  flip: { change: string; new_verdict: string } | null;
  context: string[];
  summary: string;
}

type Phase = "setup" | "running" | "result";

/* ------------------------------ helpers --------------------------------- */

function deviceId(): string {
  let id = localStorage.getItem("cp_did");
  if (!id) {
    id = `d-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    localStorage.setItem("cp_did", id);
  }
  return id;
}

const HOUR_STOPS = [12, 24, 36, 48, 72, 96, 168, 336, 720];
const hourLabel = (h: number) =>
  h < 48 ? `${h}h` : `${Math.round(h / 24)}d`;

/* ------------------------------- atoms ----------------------------------- */

function Section({
  n, title, hint, children,
}: { n: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="panel p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="mono flex h-5 w-5 items-center justify-center rounded-full border border-accent/40 bg-accent/10 text-[10px] font-bold text-accent">
          {n}
        </span>
        <h2 className="text-[14px] font-semibold text-ink-100">{title}</h2>
        {hint && <span className="text-[11px] text-ink-500">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Chips<T extends string>({
  options, value, onChange,
}: {
  options: { id: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={`min-h-[52px] rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
              active
                ? "border-accent/60 bg-accent/10"
                : "border-line bg-obsidian-850 panel-hover"
            }`}
          >
            <span className={`block text-[13.5px] font-medium ${active ? "text-ink-100" : "text-ink-300"}`}>
              {o.label}
            </span>
            {o.hint && (
              <span className="mt-0.5 block text-[11px] text-ink-500">{o.hint}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({
  on, onChange, label, hint,
}: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="panel-hover flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl border border-line bg-obsidian-850 px-3.5 py-2 text-left"
    >
      <span>
        <span className="block text-[13px] text-ink-100">{label}</span>
        {hint && <span className="block text-[11px] text-ink-500">{hint}</span>}
      </span>
      <span
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
          on ? "border-accent/60 bg-accent/25" : "border-line-2 bg-obsidian-800"
        }`}
      >
        <span
          className={`absolute top-[2px] h-5 w-5 rounded-full transition-all ${
            on ? "left-[22px] bg-accent" : "left-[2px] bg-ink-500"
          }`}
        />
      </span>
    </button>
  );
}

function Slider({
  min, max, step, value, onChange, format, label,
}: {
  min: number; max: number; step: number; value: number;
  onChange: (v: number) => void; format: (v: number) => string; label: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-[12px] text-ink-400">{label}</span>
        <span className="doto text-[15px] text-ink-100">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-11 w-full accent-accent"
      />
    </div>
  );
}

/* ------------------------------- page ------------------------------------ */

export default function PlayPage() {
  const [persona, setPersona] = useState<Persona>(PERSONAS[0]);
  const [funding, setFunding] = useState("crowd");
  const [senders, setSenders] = useState(6);
  const [roundAmounts, setRoundAmounts] = useState(false);
  const [ownProof, setOwnProof] = useState(true);
  const [hourIdx, setHourIdx] = useState(3); // 48h
  const [parkDays, setParkDays] = useState(30);
  const [dest, setDest] = useState<DestDef>(persona.destinations[0]);
  const [newPayee, setNewPayee] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceChoice>("none");
  const [nickname, setNickname] = useState("");
  const [phase, setPhase] = useState<Phase>("setup");
  const [result, setResult] = useState<PlayResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const hours = HOUR_STOPS[hourIdx];

  // reset dependent state on persona switch
  useEffect(() => {
    setFunding(persona.funding[0].id);
    setDest(persona.destinations[0]);
    setSenders(Math.min(senders, persona.maxSenders));
    setInvoice("none");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persona.id]);

  const isFund = dest.kind === "fund";
  const isCash = funding === "cash";
  const showInvoice = dest.kind !== "own" && dest.kind !== "fund";
  const perAmount = useMemo(
    () => GAME_TOTAL_GBP / (funding === "own" ? 1 : senders),
    [funding, senders]
  );

  async function submit() {
    setPhase("running");
    setError(null);
    try {
      const res = await fetch("/api/play", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          nickname: nickname.trim() || "anon",
          persona: persona.id,
          funding,
          senders: funding === "own" ? 1 : senders,
          roundAmounts,
          ownProof,
          hoursToMove: hours,
          parkDays,
          destination: dest.id,
          newPayeeSameDay: newPayee,
          invoice: showInvoice ? invoice : "none",
          deviceId: deviceId(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setResult(data as PlayResult);
      setPhase("result");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
      setPhase("setup");
    }
  }

  /* ------------------------------ result -------------------------------- */

  if (phase === "result" && result) {
    const c =
      result.verdict === "NO_ALERT"
        ? "var(--color-close)"
        : VERDICT_COLOR[result.verdict] ?? "#95a2b6";
    return (
      <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-[430px] flex-col gap-4 px-4 py-6">
        <div
          className="panel flex flex-col items-center gap-3 p-6 text-center"
          style={{ borderColor: `${c}55` }}
        >
          <span className="mono text-[10px] tracking-[0.2em] text-ink-500">
            THE ANALYST HAS DECIDED
          </span>
          <span
            className="doto text-[30px] leading-none"
            style={{ color: c }}
          >
            {result.bucket}
          </span>
          {result.verdict === "NO_ALERT" ? (
            <span className="mono rounded-full border border-close/50 bg-close/10 px-3 py-1 text-[11px] font-bold text-close">
              NO ALERT RAISED
            </span>
          ) : (
            <VerdictPill verdict={result.verdict as "CLOSE" | "RFI" | "ESCALATE"} size="lg" />
          )}
          {result.reason_code && (
            <span className="mono rounded-md border border-line bg-obsidian-800 px-2 py-0.5 text-[10px] text-ink-300">
              {result.reason_code}
            </span>
          )}
          <p className="text-[13.5px] leading-relaxed text-ink-100">{result.reason}</p>
        </div>

        {result.alerts.length > 0 && (
          <div className="panel p-4">
            <div className="mono mb-2 text-[10px] tracking-[0.18em] text-ink-500">
              RULES THAT FIRED
            </div>
            <div className="flex flex-col gap-2">
              {result.alerts.map((a) => (
                <div key={a.rule_id + a.message.slice(0, 12)} className="rounded-lg border border-line bg-obsidian-900 px-3 py-2">
                  <div className="mono text-[10px] font-bold text-accent">{a.rule_id} · {a.rule_name}</div>
                  <div className="mt-0.5 text-[11.5px] leading-snug text-ink-300">{a.message}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {result.alerts.length === 0 && (
          <div className="panel p-4 text-[12.5px] leading-relaxed text-ink-300">
            None of the institution&apos;s monitoring rules fired on your
            transactions, so no alert was ever raised. The money is out — and
            no one looked.{" "}
            <span className="text-ink-500">That&apos;s what makes it laundering.</span>
          </div>
        )}

        {result.flip && (
          <div className="panel p-4">
            <div className="mono mb-1.5 text-[10px] tracking-[0.18em] text-ink-500">
              {result.bucket === "GOT AWAY" ? "WHAT WOULD HAVE CAUGHT YOU" : "WHAT WOULD HAVE GOT YOU CLOSED"}
            </div>
            <p className="text-[12.5px] text-ink-100">
              {result.flip.change}
              <span className="mono ml-2 text-[10px] text-ink-500">→ {result.flip.new_verdict}</span>
            </p>
          </div>
        )}

        {result.context.length > 0 && (
          <div className="text-[11px] leading-relaxed text-ink-500">
            Context noted: {result.context.join(" · ")} — context for a
            reviewer, not an alert trigger on its own.
          </div>
        )}

        <p className="text-center text-[11.5px] text-ink-500">
          Watch your attempt on the big screen — look for your nickname.
        </p>

        <button
          onClick={() => { setPhase("setup"); setResult(null); }}
          className="min-h-[54px] rounded-xl border border-accent/50 bg-accent/15 text-[15px] font-bold text-accent transition-colors hover:bg-accent/20"
        >
          Try another move
        </button>
      </main>
    );
  }

  /* ------------------------------- setup --------------------------------- */

  return (
    <main className="relative z-10 mx-auto flex min-h-screen w-full max-w-[430px] flex-col gap-4 px-4 pb-40 pt-6">
      <header className="flex flex-col gap-1">
        <div className="mono flex items-center gap-2 text-[10px] tracking-[0.22em] text-accent">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent" />
          CLAUSEPROOF · LIVE GAME
        </div>
        <h1 className="text-[28px] font-black leading-none tracking-tight text-ink-100">
          BEAT THE ANALYST
        </h1>
        <p className="mt-1.5 text-[13px] leading-snug text-ink-300">
          You have <span className="font-semibold text-ink-100">{gbp(GAME_TOTAL_GBP, 0)} of
          scam money</span>. Get it out without getting caught — our real
          triage engine decides, live on the big screen.
        </p>
      </header>

      <Section n="1" title="Who are you?">
        <div className="grid grid-cols-2 gap-2">
          {PERSONAS.map((p) => {
            const active = p.id === persona.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPersona(p)}
                className={`min-h-[84px] rounded-xl border px-3 py-2.5 text-left transition-colors ${
                  active ? "border-accent/60 bg-accent/10" : "border-line bg-obsidian-850 panel-hover"
                }`}
              >
                <span className={`block text-[13.5px] font-semibold ${active ? "text-ink-100" : "text-ink-300"}`}>
                  {p.label}
                </span>
                <span className="mt-0.5 block text-[10.5px] leading-tight text-ink-500">{p.blurb}</span>
                <span className="mono mt-1.5 block text-[9px] uppercase tracking-wider text-accent/80">
                  {p.institutionLabel}
                </span>
              </button>
            );
          })}
        </div>
      </Section>

      <Section n="2" title="Get the money in" hint={gbp(GAME_TOTAL_GBP, 0)}>
        <div className="flex flex-col gap-3">
          <Chips
            options={persona.funding.map((f) => ({ id: f.id as string, label: f.label, hint: f.hint }))}
            value={funding}
            onChange={setFunding}
          />
          {funding !== "own" && (
            <>
              <Slider
                min={1} max={persona.maxSenders} step={1}
                value={senders} onChange={setSenders}
                format={(v) => `${v}`}
                label={isCash ? "How many deposits?" : "How many people pay you?"}
              />
              <div className="mono rounded-lg border border-line bg-obsidian-900 px-3 py-2 text-[11px] text-ink-300">
                {senders === 1 ? "1 payment" : `${senders} payments`} of {gbp(perAmount)} each
                {isCash && perAmount >= 800 && perAmount < 1000 && persona.institution === "emoney" && (
                  <span className="text-rfi"> — inside the £800–£1,000 watch band</span>
                )}
                {isCash && perAmount >= 9000 && perAmount < 10000 && persona.institution === "bank" && (
                  <span className="text-rfi"> — inside the £9,000–£10,000 watch band</span>
                )}
              </div>
              <Toggle
                on={roundAmounts} onChange={setRoundAmounts}
                label="Round amounts"
                hint="£25 multiples — context, not an alert trigger"
              />
            </>
          )}
          {funding === "own" && (
            <Toggle
              on={ownProof} onChange={setOwnProof}
              label="Attach my bank statement"
              hint="proves the other account is yours"
            />
          )}
        </div>
      </Section>

      <Section n="3" title="Get it out">
        <div className="flex flex-col gap-3">
          <Chips
            options={persona.destinations.map((d) => ({ id: d.id, label: d.label, hint: d.hint }))}
            value={dest.id}
            onChange={(id) => setDest(persona.destinations.find((d) => d.id === id)!)}
          />
          {isFund ? (
            <Slider
              min={7} max={120} step={1}
              value={parkDays} onChange={setParkDays}
              format={(v) => `${v} days`}
              label="Days parked in the fund"
            />
          ) : (
            <Slider
              min={0} max={HOUR_STOPS.length - 1} step={1}
              value={hourIdx} onChange={setHourIdx}
              format={(v) => hourLabel(HOUR_STOPS[v])}
              label="Hours until the money leaves"
            />
          )}
          {hours <= 48 && !isFund && (
            <div className="text-[11px] leading-snug text-ink-500">
              Rapid-movement rules watch money that leaves within 48 hours of
              arriving (10 days at an investment firm).
            </div>
          )}
          <Toggle
            on={newPayee} onChange={setNewPayee}
            label="Add the payee today"
            hint="new payee same day — context, not an alert trigger"
          />
          {showInvoice && (
            <div>
              <div className="mb-1.5 text-[12px] text-ink-400">Attach an invoice for the payment?</div>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { id: "none", label: "No invoice" },
                  { id: "matching", label: "Matches amount" },
                  { id: "mismatch", label: "Wrong amount" },
                ] as { id: InvoiceChoice; label: string }[]).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setInvoice(o.id)}
                    className={`min-h-[48px] rounded-xl border px-2 py-2 text-[12px] font-medium ${
                      invoice === o.id
                        ? "border-accent/60 bg-accent/10 text-ink-100"
                        : "border-line bg-obsidian-850 panel-hover text-ink-400"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Section>

      <Section n="4" title="Your nickname" hint="shown on the big screen">
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value.slice(0, 18))}
          placeholder="e.g. smooth_operator"
          className="mono min-h-[52px] w-full rounded-xl border border-line bg-obsidian-850 px-3.5 text-[15px] text-ink-100 placeholder:text-ink-600 focus:border-accent/60 focus:outline-none"
        />
      </Section>

      {error && (
        <div className="rounded-xl border border-escalate/50 bg-escalate/10 px-3.5 py-2.5 text-[12.5px] text-escalate">
          {error}
        </div>
      )}

      {/* sticky submit */}
      <div className="fixed inset-x-0 bottom-0 z-20 mx-auto w-full max-w-[430px] bg-gradient-to-t from-obsidian-950 via-obsidian-950/95 to-transparent px-4 pb-5 pt-8">
        <button
          onClick={submit}
          disabled={phase === "running"}
          className="min-h-[58px] w-full rounded-xl border border-accent/60 bg-accent/20 text-[16px] font-black tracking-wide text-accent transition-colors hover:bg-accent/25 disabled:opacity-60"
        >
          {phase === "running" ? (
            <span className="cp-dots">THE ANALYST IS READING YOUR FILE</span>
          ) : (
            <>MOVE <span className="doto text-[17px]">{gbpShort(GAME_TOTAL_GBP)}</span> →</>
          )}
        </button>
        <div className="mono mt-2 text-center text-[9.5px] tracking-[0.18em] text-ink-600">
          REAL ENGINE · REAL POLICY · NOTHING LEAVES THIS LAPTOP
        </div>
      </div>
    </main>
  );
}
