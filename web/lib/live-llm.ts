// Optional LLM parsing for /live: turns free text into the strict
// LiveScenario JSON so users can type anything. Runs server-side only —
// keys come from env, are never logged, and never reach the client.
// The VERDICT is never produced by the model; it only fills the form.
// Deterministic engine decides; this is just a smarter parser.

import {
  normalizeScenario,
  parseScenarioLocal,
  type LiveScenario,
  type ParseOutcome,
} from "./live-scenario.ts";

const SCHEMA_HELP = `You convert a plain-English description of a bank/payment customer's activity into strict JSON for a transaction-monitoring demo. Output ONLY JSON, no markdown.

Schema:
{
  "institution": "bank" | "emoney" | "investment" | "payments_fx",
  "customerKind": "individual" | "business",
  "customerName": string (invent a plausible UK name if none given; add " Ltd" for businesses),
  "activity": string (occupation or business activity, 2-6 words),
  "monthlyGbp": number (declared monthly income for individuals, monthly turnover for businesses; annual figures /12; sensible default if unstated),
  "expectedCountries": string[] (countries the customer declared; always include "United Kingdom", add any they say they deal with),
  "employer": string | null,
  "payments": [{
    "direction": "in" | "out",
    "amountGbp": number,
    "counterparty": string | null (null for cash; a person's or company's name otherwise; the customer's own name for own-account transfers),
    "country": string (counterparty country, full name e.g. "Russia", "United Arab Emirates"),
    "channel": "bank_transfer" | "cash" | "card" | "fund_buy" | "fund_sell" | "crypto",
    "day": number 1-30 (when in the month it happens),
    "hour": number 0-23,
    "ownAccount": boolean,
    "reference": string | null (e.g. "SALARY")
  }],
  "docs": [{
    "type": "invoice" | "contract" | "receivable" | "employment" | "bank_statement" | "gift_letter" | "loan_agreement" | "cash_records" | "event_letter" | "register",
    "partyName": string | null,
    "amountGbp": number | null (null = same as the linked payment),
    "matching": boolean (false = document exists but for a wrong amount),
    "linkedPaymentId": null
  }],
  "priorReviewCounterparty": string | null (a counterparty an earlier review cleared),
  "listHitCounterparty": string | null (a counterparty on the bank's internal watchlist),
  "dormant": boolean (account unused for 6+ months before this activity)
}

Rules:
- "gets £9,000 from 6 strangers" = SIX separate "in" payments summing to £9,000, each a different plausible UK person name, same day or spread as described.
- "sends it / sends the money" with no amount = out payment of the same total received.
- Timing: "an hour later" = same day ~1h after the last money in; "a week later" = +7 days; unspecified = leave a 3-4 day gap.
- Cash = channel "cash". "Deposits £9,500 in cash" = direction "in", channel "cash", counterparty null.
- Dubai/UAE -> country "United Arab Emirates". High-risk list: Afghanistan, Belarus, DR Congo, Haiti, Iran, Iraq, Lebanon, Libya, Mali, Myanmar, North Korea, Russia, Somalia, South Sudan, Syria, Venezuela, Yemen.
- "buys fund units" = direction "out", channel "fund_buy"; "sells them back" = direction "in", channel "fund_sell".
- investment = investor/fund/shares/ISA; payments_fx = business paying suppliers abroad / FX; emoney = app/wallet/top-up account; otherwise bank.
- linkedPaymentId must always be null (we link by order).
- Do NOT invent documents the text doesn't mention. "no documents/nothing on file" = empty docs array.`;

interface LlmEndpoint {
  url: string;
  key: string;
  model: string;
  tag: "grok" | "openai";
}

function pickEndpoint(): LlmEndpoint | null {
  const xai = process.env.XAI_API_KEY?.trim();
  if (xai) {
    return {
      url: "https://api.x.ai/v1/chat/completions",
      key: xai,
      model: process.env.XAI_MODEL?.trim() || "grok-4-fast",
      tag: "grok",
    };
  }
  const oai = process.env.OPENAI_API_KEY?.trim();
  if (oai) {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      key: oai,
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
      tag: "openai",
    };
  }
  return null;
}

const LLM_TIMEOUT_MS = 6_000; // Grok never blocks the run — local fallback after this

async function callLlm(ep: LlmEndpoint, text: string): Promise<LiveScenario | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  try {
    const res = await fetch(ep.url, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${ep.key}`,
      },
      body: JSON.stringify({
        model: ep.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SCHEMA_HELP },
          { role: "user", content: text.slice(0, 3000) },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    const parsed = JSON.parse(content);
    return normalizeScenario({ ...parsed, sourceText: text });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface GrokParseResult {
  outcome: ParseOutcome;
  /** wall time of the LLM attempt (ms), null when no endpoint is configured */
  ms: number | null;
  /** the endpoint tag actually used, or null when nothing was tried */
  attempted: "grok" | "openai" | null;
}

/** Opt-in LLM parse: tries the configured endpoint with a hard 6s timeout,
 * then falls back to the deterministic local parser — it can never block
 * the engine run. */
export async function parseWithGrok(text: string): Promise<GrokParseResult> {
  const ep = pickEndpoint();
  if (!ep) {
    const local = parseScenarioLocal(text);
    local.notes.unshift("No LLM key configured — used the instant local parser.");
    return { outcome: local, ms: null, attempted: null };
  }
  const t0 = Date.now();
  const scenario = await callLlm(ep, text);
  const ms = Date.now() - t0;
  if (scenario && scenario.payments.length) {
    return { outcome: { scenario, parser: ep.tag, notes: [] }, ms, attempted: ep.tag };
  }
  const local = parseScenarioLocal(text);
  local.notes.unshift(
    ms >= LLM_TIMEOUT_MS - 100
      ? `Grok didn't answer within ${LLM_TIMEOUT_MS / 1000}s — used the instant local parser.`
      : "Grok couldn't structure that — used the instant local parser."
  );
  return { outcome: local, ms, attempted: ep.tag };
}

/** Parse free text into a scenario: LLM when a key is configured,
 * deterministic local parser otherwise (and on any LLM failure). */
export async function parseScenario(text: string): Promise<ParseOutcome> {
  const ep = pickEndpoint();
  if (ep) {
    const scenario = await callLlm(ep, text);
    if (scenario && scenario.payments.length) {
      return { scenario, parser: ep.tag, notes: [] };
    }
    const local = parseScenarioLocal(text);
    local.notes.unshift("LLM parse unavailable — fell back to the local parser.");
    return local;
  }
  return parseScenarioLocal(text);
}
