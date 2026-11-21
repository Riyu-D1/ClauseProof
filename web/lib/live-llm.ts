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

const LLM_TIMEOUT_MS = 8_000;

export type LlmTag = "grok" | "openai";

interface LlmEndpoint {
  url: string;
  key: string;
  model: string;
  tag: LlmTag;
}

/** Which parser the "parse with LLM" toggle would use, or null when no key
 * is configured. Safe to hand to the client — it's a label, not a secret. */
export function configuredLlmTag(): LlmTag | null {
  if (process.env.XAI_API_KEY?.trim()) return "grok";
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  return null;
}

function pickEndpoint(): LlmEndpoint | null {
  const xai = process.env.XAI_API_KEY?.trim();
  if (xai) {
    return {
      url: "https://api.x.ai/v1/chat/completions",
      key: xai,
      // a fast non-reasoning model by default — the reasoning aliases can
      // blow the 8s budget. XAI_MODEL overrides (set in .env.local).
      model: process.env.XAI_MODEL?.trim() || "grok-4-fast-non-reasoning",
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

interface LlmCall {
  scenario: LiveScenario | null;
  ms: number;
  /** short error class safe for logs and the UI — never contains the key */
  fail: string | null;
}

/** Pull a JSON object out of a chat completion: strips ```json fences,
 * then falls back to the outermost { … } span. */
function extractJson(content: string): unknown {
  const unfenced = content
    .trim()
    .replace(/^```(?:json|JSON)?\s*/, "")
    .replace(/\s*```\s*$/, "");
  const span = content.slice(
    content.indexOf("{"),
    content.lastIndexOf("}") + 1
  );
  for (const cand of [unfenced, span]) {
    if (!cand) continue;
    try {
      const v = JSON.parse(cand);
      if (v && typeof v === "object") return v;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** One chat-completions call, classified. Any failure returns fail=reason —
 * the key itself is never put into `fail` or the console. */
async function callLlm(ep: LlmEndpoint, text: string): Promise<LlmCall> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LLM_TIMEOUT_MS);
  const t0 = Date.now();
  let fail: string | null = null;
  let scenario: LiveScenario | null = null;
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
        // xAI and OpenAI both accept OpenAI-style json_object on the chat
        // endpoint; fences/loose text are still stripped client-side.
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SCHEMA_HELP },
          { role: "user", content: text.slice(0, 3000) },
        ],
      }),
    });
    if (!res.ok) {
      let detail = "";
      try {
        const errBody = (await res.json()) as {
          error?: unknown;
          message?: unknown;
          code?: unknown;
        };
        const raw = errBody?.error ?? errBody?.message ?? errBody?.code;
        const msg = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
        // keep it short and drop anything that could carry the key
        if (msg && !msg.includes(ep.key)) detail = `: ${msg.slice(0, 140)}`;
      } catch {
        // body wasn't JSON — status alone is the reason
      }
      fail = `HTTP ${res.status}${detail}`;
    } else {
      const data = (await res.json()) as {
        choices?: { message?: { content?: unknown } }[];
      };
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        fail = "empty response";
      } else {
        const parsed = extractJson(content);
        if (parsed == null) {
          fail = "unparseable JSON in response";
        } else {
          const sc = normalizeScenario({
            ...(parsed as Record<string, unknown>),
            sourceText: text,
          });
          if (!sc.payments.length) fail = "model returned no payments";
          else scenario = sc;
        }
      }
    }
  } catch (e) {
    fail =
      e instanceof Error && e.name === "AbortError"
        ? `timeout after ${LLM_TIMEOUT_MS / 1000}s`
        : "network error";
  } finally {
    clearTimeout(timer);
  }
  const ms = Date.now() - t0;
  if (fail) {
    console.warn(
      `[live] ${ep.tag} parse failed: ${fail} (model ${ep.model}, ${ms}ms)`
    );
  }
  return { scenario, ms, fail };
}

/** Parse free text into a scenario. With `useLlm` on (default) and a key
 * configured, the LLM fills the card; on any failure — reported in `notes`
 * — the deterministic local parser takes over. */
export async function parseScenario(
  text: string,
  opts?: { useLlm?: boolean }
): Promise<ParseOutcome> {
  const ep = opts?.useLlm === false ? null : pickEndpoint();
  if (!ep) {
    const t0 = Date.now();
    const local = parseScenarioLocal(text);
    local.ms = Date.now() - t0;
    return local;
  }
  const call = await callLlm(ep, text);
  if (call.scenario) {
    return { scenario: call.scenario, parser: ep.tag, notes: [], ms: call.ms };
  }
  const local = parseScenarioLocal(text);
  local.ms = call.ms;
  local.notes.unshift(
    `${ep.tag === "grok" ? "Grok" : "OpenAI"} parse failed (${
      call.fail ?? "unknown"
    }) — used the local parser.`
  );
  return local;
}
