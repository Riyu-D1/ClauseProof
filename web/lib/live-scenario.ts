// "Try it live" — the scenario contract.
//
// A LiveScenario is the editable middle layer: free text (or clicks) builds
// one, the scenario card edits it, and live-case.ts turns it into a
// dataset-format case that runs through the real engine. The parser below is
// deterministic (regex/keywords, no model) and is the always-available path;
// live-llm.ts may fill the same shape via Grok/OpenAI when a key is set.
//
// Erasable-syntax-only TypeScript so `node` ≥22.18 can run it directly
// (the proof script imports this file — keep enums/namespaces out).

export type LiveInstitution = "bank" | "emoney" | "investment" | "payments_fx";

export type LiveChannel =
  | "bank_transfer" // faster_payment / swift / bacs / wallet_transfer
  | "cash"          // cash_deposit / cash_topup / cash_withdrawal
  | "card"          // card spend (out only)
  | "fund_buy"      // fund_subscription (investment, out)
  | "fund_sell"     // fund_redemption (investment, in)
  | "crypto";       // transfer to a crypto exchange counterparty (context)

export interface LivePayment {
  id: string;
  direction: "in" | "out";
  amountGbp: number;
  /** null => cash / no counterparty */
  counterparty: string | null;
  country: string;
  channel: LiveChannel;
  /** day inside the review window, 1-30 */
  day: number;
  /** hour of day, 0-23 (fractional ok) */
  hour: number;
  /** counterparty is an account in the customer's own name */
  ownAccount: boolean;
  reference?: string;
}

export type LiveDocType =
  | "invoice"         // payable: covers an outgoing payment
  | "contract"        // payable
  | "receivable"      // invoice the customer issued: covers money in
  | "employment"      // employment contract / payslip (life event, salary)
  | "bank_statement"  // proves an own-name external account
  | "gift_letter"     // documents a gift from a named person (+their DoB)
  | "loan_agreement"  // documents a loan from a named party
  | "cash_records"    // takings book / cash reconciliation
  | "event_letter"    // solicitor/sale/insurer letter: one-off money in
  | "register";       // company register extract for a counterparty

export interface LiveDoc {
  id: string;
  type: LiveDocType;
  /** party the document names (payee, payer, lender, holder…) */
  partyName: string | null;
  /** documented amount; null = mirror the linked payment's amount */
  amountGbp: number | null;
  /** when false, the doc exists but for a wrong amount (mismatch demo) */
  matching: boolean;
  /** payment id this document is meant to cover, if any */
  linkedPaymentId: string | null;
  /** DoB a document attests for its party (gift letters). Flipping this
   * is how a TM22 match gets proven or cleared. */
  partyDob: string | null;
}

export interface LiveScenario {
  institution: LiveInstitution;
  institutionAuto: boolean; // true when auto-picked from the text
  customerKind: "individual" | "business";
  customerName: string;
  /** free-text occupation or business activity */
  activity: string;
  /** declared monthly income (individual) or monthly turnover share */
  monthlyGbp: number;
  expectedCountries: string[];
  employer: string | null;
  payments: LivePayment[];
  docs: LiveDoc[];
  /** surname/name of a counterparty an earlier CLOSE review covered */
  priorReviewCounterparty: string | null;
  /** counterparty matching a synthetic internal-list entry (fires TM22) */
  listHitCounterparty: string | null;
  dormant: boolean;
  /** parser-only context chips (never trigger alerts on their own) */
  contextFlags: string[];
  sourceText?: string;
}

export interface ParseOutcome {
  scenario: LiveScenario;
  parser: "local" | "grok" | "openai";
  /** honest notes about what the parser guessed (or why the LLM didn't run) */
  notes: string[];
  /** wall-clock parse time in ms — shown on the parser badge */
  ms?: number;
}

/* ------------------------------- vocabulary ------------------------------ */

export const HIGH_RISK_SET = [
  "Afghanistan", "Belarus", "Democratic Republic of the Congo", "Haiti",
  "Iran", "Iraq", "Lebanon", "Libya", "Mali", "Myanmar", "North Korea",
  "Russia", "Somalia", "South Sudan", "Syria", "Venezuela", "Yemen",
];

const COUNTRY_ALIASES: [RegExp, string][] = [
  [/\bdubai|u\.?a\.?e\.?|abu dhabi|emirates\b/i, "United Arab Emirates"],
  [/\brussia/i, "Russia"],
  [/\biran/i, "Iran"],
  [/\biraq/i, "Iraq"],
  [/\bsyria/i, "Syria"],
  [/\bnorth korea/i, "North Korea"],
  [/\bsomalia/i, "Somalia"],
  [/\byemen/i, "Yemen"],
  [/\blebanon/i, "Lebanon"],
  [/\blibya/i, "Libya"],
  [/\bmali\b/i, "Mali"],
  [/\bmyanmar|burma\b/i, "Myanmar"],
  [/\bhaiti/i, "Haiti"],
  [/\bbelarus/i, "Belarus"],
  [/\bafghanistan/i, "Afghanistan"],
  [/\bvenezuela/i, "Venezuela"],
  [/\b(congo|drc)\b/i, "Democratic Republic of the Congo"],
  [/\bsouth sudan/i, "South Sudan"],
  [/\bspain|spanish\b/i, "Spain"],
  [/\bfrance|french\b/i, "France"],
  [/\bpoland|polish\b/i, "Poland"],
  [/\bturkey|türkiye|turkish\b/i, "Turkey"],
  [/\bindia\b/i, "India"],
  [/\bchina\b|chinese\b/i, "China"],
  [/\bnigeria\b/i, "Nigeria"],
  [/\bukraine\b/i, "Ukraine"],
  [/\bgermany|german\b/i, "Germany"],
  [/\bitaly|italian\b/i, "Italy"],
  [/\bpakistan\b/i, "Pakistan"],
  [/\bbrazil\b/i, "Brazil"],
  [/\b(usa|u\.?s\.?a\.?|america|united states)\b/i, "United States"],
  [/\buk\b|united kingdom|britain|british\b/i, "United Kingdom"],
];

const WORD_NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, twenty: 20,
  thirty: 30,
};

const FIRST_NAMES = [
  "Casey Alderton", "Rowan Bexley", "Jamie Callow", "Morgan Dewhurst",
  "Taylor Evershot", "Jordan Fennick", "Sam Greycliff", "Riley Harbrook",
  "Alex Imber", "Charlie Keston", "Frankie Larch", "Drew Marley",
  "Kim Neris", "Robin Oxwick", "Ash Pennifold", "Lou Quarrie",
  "Eli Renford", "Mel Storridge", "Gail Tavener", "Kit Underhay",
];
const FAMILY_NAMES = ["Merritt", "Calshaw", "Denholm", "Farnley", "Osbrook"];
const BIZ_NAMES = [
  "Calder & Sons Ltd", "Brindle Trading Ltd", "Oskom Supplies Ltd",
  "Ferncroft Logistics Ltd", "Dellmere Services Ltd", "Quillrose Ltd",
];

export const OWN_ACCT_NO = "41-27-83 90217744";
export const PAYEE_ACCT_NO = "63-09-18 55420136";

/* ------------------------------- examples -------------------------------- */

export const EXAMPLE_PROMPTS: { label: string; text: string }[] = [
  {
    label: "Money mule",
    text: "A student who earns £800 a month gets £9,000 from 6 strangers in a day and sends it to Dubai an hour later",
  },
  {
    label: "Structuring",
    text: "A waiter earning £1,900 a month pays in £9,500 cash three times in a week, each just under the £10,000 reporting threshold",
  },
  {
    label: "Legit invoice",
    text: "A café pays its coffee supplier £12,000 with a matching invoice",
  },
  {
    label: "Own account",
    text: "A landlord gets £14,000 from tenants and moves it to his own savings account, with a bank statement proving it is his",
  },
  {
    label: "Refund",
    text: "A nurse gets £3,200 back from Volaria Travel Ltd as a refund of an earlier payment, with a letter confirming the refund",
  },
  {
    label: "Crypto",
    text: "A developer who earns £4,000 a month gets £9,000 from 5 different people and sends it to a crypto exchange the next day",
  },
];

export const ROTATING_PLACEHOLDERS = EXAMPLE_PROMPTS.map((e) => e.text);

/* ------------------------------ normalizer ------------------------------- */

const uid = () => Math.random().toString(36).slice(2, 9);
export const newPayId = () => `p${uid()}`;
export const newDocId = () => `d${uid()}`;

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

/** Sanitise any half-parsed scenario (LLM, local, or edited card) into a
 * shape the case builder can trust. */
export function normalizeScenario(raw: unknown): LiveScenario {
  const r = (raw ?? {}) as Record<string, unknown>;
  const inst: LiveInstitution = (
    ["bank", "emoney", "investment", "payments_fx"] as const
  ).includes(r.institution as LiveInstitution)
    ? (r.institution as LiveInstitution)
    : "bank";
  const kind = r.customerKind === "business" ? "business" : "individual";

  const payments: LivePayment[] = [];
  for (const p of (Array.isArray(r.payments) ? r.payments : []).slice(0, 60)) {
    const o = (p ?? {}) as Record<string, unknown>;
    const amt = Number(o.amountGbp);
    if (!Number.isFinite(amt) || amt <= 0 || amt > 100_000_000) continue;
    const dir = o.direction === "out" ? "out" : "in";
    const ch: LiveChannel = (
      ["bank_transfer", "cash", "card", "fund_buy", "fund_sell", "crypto"] as const
    ).includes(o.channel as LiveChannel)
      ? (o.channel as LiveChannel)
      : dir === "in" ? "bank_transfer" : "bank_transfer";
    const cp = o.counterparty == null ? null : String(o.counterparty).slice(0, 80);
    payments.push({
      id: typeof o.id === "string" && o.id ? o.id : newPayId(),
      direction: dir,
      amountGbp: Math.round(amt * 100) / 100,
      counterparty: cp || null,
      country: String(o.country || "United Kingdom").slice(0, 60),
      channel: ch,
      day: clamp(Math.round(Number(o.day) || 10), 1, 30),
      hour: clamp(Number(o.hour) || 9, 0, 23.9),
      ownAccount: o.ownAccount === true,
      reference: typeof o.reference === "string" ? o.reference.slice(0, 60) : undefined,
    });
  }

  const docs: LiveDoc[] = [];
  for (const d of (Array.isArray(r.docs) ? r.docs : []).slice(0, 20)) {
    const o = (d ?? {}) as Record<string, unknown>;
    const t = o.type as LiveDocType;
    if (!(
      ["invoice", "contract", "receivable", "employment", "bank_statement",
       "gift_letter", "loan_agreement", "cash_records", "event_letter",
       "register"] as const
    ).includes(t)) continue;
    const amt = o.amountGbp == null ? null : Number(o.amountGbp);
    docs.push({
      id: typeof o.id === "string" && o.id ? o.id : newDocId(),
      type: t,
      partyName: o.partyName == null ? null : String(o.partyName).slice(0, 80),
      amountGbp: amt != null && Number.isFinite(amt) && amt > 0
        ? Math.round(amt * 100) / 100 : null,
      matching: o.matching !== false,
      linkedPaymentId: typeof o.linkedPaymentId === "string" ? o.linkedPaymentId : null,
      partyDob: typeof o.partyDob === "string" ? o.partyDob.slice(0, 10) : null,
    });
  }

  const countries = Array.isArray(r.expectedCountries)
    ? r.expectedCountries.map(String).slice(0, 12)
    : ["United Kingdom"];
  if (!countries.includes("United Kingdom")) countries.unshift("United Kingdom");

  const income = Number(r.monthlyGbp);
  return {
    institution: inst,
    institutionAuto: r.institutionAuto !== false,
    customerKind: kind,
    customerName:
      String(r.customerName || "").slice(0, 60) ||
      (kind === "business" ? "Live Trading Ltd" : "Alex Ashford"),
    activity: String(r.activity || (kind === "business" ? "Small business" : "Customer")).slice(0, 80),
    monthlyGbp:
      Number.isFinite(income) && income > 0
        ? Math.round(income)
        : kind === "business" ? 20000 : 2500,
    expectedCountries: countries,
    employer: r.employer ? String(r.employer).slice(0, 80) : null,
    payments,
    docs,
    priorReviewCounterparty:
      typeof r.priorReviewCounterparty === "string" && r.priorReviewCounterparty
        ? r.priorReviewCounterparty.slice(0, 80)
        : null,
    listHitCounterparty:
      typeof r.listHitCounterparty === "string" && r.listHitCounterparty
        ? r.listHitCounterparty.slice(0, 80)
        : null,
    dormant: r.dormant === true,
    contextFlags: Array.isArray(r.contextFlags)
      ? r.contextFlags.map(String).slice(0, 8)
      : [],
    sourceText: typeof r.sourceText === "string" ? r.sourceText.slice(0, 800) : undefined,
  };
}

/* ------------------------------ local parser ----------------------------- */

function money(s: string): number | null {
  const m = /£?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*([kKmM])?/.exec(s);
  if (!m) return null;
  let n = parseFloat(m[1].replace(/,/g, ""));
  if (m[2]) n *= m[2].toLowerCase() === "m" ? 1_000_000 : 1_000;
  return Number.isFinite(n) ? n : null;
}

/** all £-amounts with their index, longest first */
function amountsIn(s: string): { value: number; index: number; raw: string }[] {
  const re = /£\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*([kKmM])?|([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(k|m)\b/gi;
  const out: { value: number; index: number; raw: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const v = money(m[0]);
    if (v != null) out.push({ value: v, index: m.index, raw: m[0] });
  }
  return out;
}

function findCountry(s: string): string | null {
  for (const [re, name] of COUNTRY_ALIASES) {
    if (re.test(s)) {
      if (name === "United Kingdom") continue; // never a destination
      return name;
    }
  }
  return null;
}

function countOf(s: string, words: string): number | null {
  const re = new RegExp(`(\\d+|${Object.keys(WORD_NUM).join("|")})\\s+(?:different\\s+)?(?:${words})`, "i");
  const m = re.exec(s);
  if (!m) return null;
  const w = m[1].toLowerCase();
  return /^\d+$/.test(w) ? parseInt(w, 10) : WORD_NUM[w] ?? null;
}

/** even split into n near-round parts, deterministic */
export function splitEven(total: number, n: number): number[] {
  if (n <= 1) return [total];
  const u = Math.max(25, Math.round(total / n / 25) * 25);
  const amts = Array(n - 1).fill(u) as number[];
  amts.push(Math.round((total - u * (n - 1)) * 100) / 100);
  return amts;
}

const titleCase = (s: string) =>
  s.replace(/\b\w/g, (c) => c.toUpperCase());

function senderName(rel: string, i: number, surname: string | null): string {
  if (rel === "own") return "";
  if (rel === "family") return `${FIRST_NAMES[i % FIRST_NAMES.length].split(" ")[0]} ${surname ?? FAMILY_NAMES[i % FAMILY_NAMES.length]}`;
  if (rel === "customer" || rel === "business" || rel === "client")
    return BIZ_NAMES[i % BIZ_NAMES.length];
  if (rel === "supplier") return BIZ_NAMES[i % BIZ_NAMES.length];
  return FIRST_NAMES[i % FIRST_NAMES.length];
}

interface Segment {
  text: string;
  index: number;
}

/** rough clause splitter: keeps order, splits on "and then", ";", ".",
 * " then ", " and " followed by a verb of movement. */
function clauses(text: string): Segment[] {
  const parts = text.split(/(;|\.(?=\s)|\band then\b|\bthen\b|,\s*(?=and\b))/i);
  const segs: Segment[] = [];
  let idx = 0;
  for (const p of parts) {
    const t = p.trim();
    if (!t || /^[;.,]|then$/i.test(t)) { idx += p.length; continue; }
    // further split on " and " when followed by a movement verb
    let sub = 0;
    const inner = t.split(/\band\b(?=\s+(?:sends?|sending|transfers?|pays?|paying|moves?|moving|wires?|deposits?|withdraws?|buys?|sells?|tops?\s?up|spends?|gets?|receives?|takes?))/i);
    for (const q of inner) {
      const qt = q.trim();
      if (qt) segs.push({ text: qt, index: idx + sub });
      sub += q.length + 3;
    }
    idx += p.length;
  }
  return segs;
}

const IN_VERBS = /(?:gets?|got|receives?|received|is paid|was paid|paid in|pays? in|takes? in|took in|deposits?|deposited|tops?\s?up(?:s|ped)?|collects?|collected|sells?|sold|withdraws? £[\d,.kKmM]+ (?:in )?cash|lands?)\b/i;
const OUT_VERBS = /(?:sends?|sent|transfers?|transferred|pays?|paid|moves?|moved|wires?|wired|spends?|spent|withdraws?|withdrew|forwards?|forwarded|ships?|buys?|bought)\b/i;

function relWord(seg: string): string | null {
  if (/\bstrangers?\b|\bunrelated\b|\bdifferent people\b|\bpeople\b/i.test(seg)) return "stranger";
  if (/\bfriends?\b|\bmates?\b/i.test(seg)) return "friend";
  if (/\b(family|relatives?|uncle|aunt|mum|dad|mother|father|parents?|cousin|brother|sister|gran|gran(d)?ma)\b/i.test(seg)) return "family";
  if (/\bcustomers?\b|\bclients?\b|\bbuyers?\b/i.test(seg)) return "customer";
  if (/\bsuppliers?\b|\bcompanies\b|\bfirms?\b|\bbusinesses\b|\bvendors?\b/i.test(seg)) return "business";
  if (/\btenants?\b|\blodgers?\b/i.test(seg)) return "tenant";
  if (/\bemployer\b|\bboss\b|\bpayroll\b|\bsalary\b|\bwages\b/i.test(seg)) return "employer";
  if (/\bsolicitors?\b|\bexecutors?\b|\bestate\b/i.test(seg)) return "solicitor";
  if (/\bhis own\b|\bher own\b|\btheir own\b|\bits own\b|\bmy own\b|\bown account|\bown bank|\bown savings/i.test(seg)) return "own";
  return null;
}

function guessInstitution(text: string, kind: string, payments: { out: { country: string }[] }): { inst: LiveInstitution; auto: boolean } {
  if (/\binvest(or|ment|ing)?s?\b|\bfund units?\b|\bshares\b|\bisa\b|\bbroker|\bportfolio\b|\bfund\b/i.test(text))
    return { inst: "investment", auto: true };
  if (/\be-?money\b|\bwallet\b|\bapp account\b|\btop ?ups?\b|\bmonzo\b|\brevolut\b/i.test(text))
    return { inst: "emoney", auto: true };
  const foreignOut = payments.out.some((o) => o.country !== "United Kingdom");
  if (
    /\bfx\b|foreign exchange|currency (?:exchange|firm)|import|export|euros?\b|\bdollars?\b|pays?\s+\w+\s+suppliers?\s+abroad|\boverseas suppliers?\b/i.test(text) ||
    (kind === "business" && foreignOut && /supplier|invoice|contract/i.test(text))
  )
    return { inst: "payments_fx", auto: true };
  return { inst: "bank", auto: true };
}

/** Deterministic free-text → LiveScenario. Regex/keyword based — it handles
 * the common shapes well and stays honest when it can't. */
export function parseScenarioLocal(text: string): ParseOutcome {
  const notes: string[] = [];
  const lower = text.toLowerCase();
  const seg = clauses(text);

  // ---- customer ----
  const kind: "individual" | "business" =
    /\b(ltd|limited|llc|plc|company|firm|bakery|shop|store|salon|barbers?|garage|restaurant|takeaway|studio|workshop|brewery|florist|butchers?|pharmacy|clinic|pub|importers?|exporters?|manufacturer|wholesalers?)\b|caf[eé]/i.test(text)
      ? "business"
      : "individual";

  const whoMatch =
    /^(?:a|an|the|my)\s+([a-zà-ÿ' -]{2,60}?)(?:\s+(?:who|that)\b|\s+(?:gets?|receives?|earns?|deposits?|pays?|sends?|has|had|keeps?|moves?|with|,|\.|$))/i.exec(text.trim());
  let activity = whoMatch ? whoMatch[1].trim() : "";
  if (/^account\b/i.test(activity)) activity = "customer";
  if (!activity) activity = kind === "business" ? "small business" : "customer";

  // ---- declared monthly ----
  let monthlyGbp: number | null = null;
  const inc =
    /(?:earns?|makes?|brings in|declared?|declares?|income of|turnover of|salary of|takes?)\s*(?:about\s+|around\s+|roughly\s+)?(£[\d,.]+[kKmM]?)/i.exec(text);
  if (inc) {
    const v = money(inc[1]);
    if (v != null) {
      monthlyGbp = v;
      if (/a year|per year|annually|\/yr|p\.a\./i.test(inc[0])) monthlyGbp = Math.round(v / 12);
      else if (!/month/i.test(inc[0]) && !/turnover|salary|income/i.test(inc[0])) {
        // "earns £800 a month" is caught by the month check; bare "earns £800" assume monthly anyway
      }
    }
  }
  const annMatch = /(£[\d,.]+[kKmM]?)\s*(?:a|per)\s*year/i.exec(text);
  if (monthlyGbp == null && annMatch) {
    const v = money(annMatch[1]);
    if (v != null) monthlyGbp = Math.round(v / 12);
  }
  const monMatch = /(£[\d,.]+[kKmM]?)\s*(?:a|per|each|\/)\s*month/i.exec(text);
  if (monthlyGbp == null && monMatch) {
    const v = money(monMatch[1]);
    if (v != null) monthlyGbp = Math.round(v);
  }
  if (monthlyGbp == null) {
    monthlyGbp = kind === "business" ? 20000 : 2500;
    notes.push(`No income declared — assumed ${kind === "business" ? "£20,000/month turnover" : "£2,500/month income"} (edit it on the card).`);
  }

  // ---- customer name ----
  const surname = FAMILY_NAMES[0];
  const customerName =
    kind === "business"
      ? `${titleCase(activity.replace(/\s+/g, " ").slice(0, 30))} Ltd`
      : `Alex ${surname}`;
  const familySurname = kind === "individual" ? surname : null;

  // ---- payments ----
  const payments: LivePayment[] = [];
  const contextFlags: string[] = [];
  let lastInIdx = -1;
  let senderPool: { rel: string; count: number; total: number } | null = null;

  // simpler per-clause approach
  let inSeq = 0, outSeq = 0;
  for (const s of seg) {
    const t = s.text;

    // ---------- incoming ----------
    const inM = IN_VERBS.exec(t);
    const cashDeposit = /(?:deposits?|pays? in|tops?\s?up)/i.test(t) && /cash\b/i.test(t);
    const hasInVerb = !!inM && !/earns?|spent/i.test(inM[0]);

    if (hasInVerb) {
      const amts = amountsIn(t.slice(inM.index));
      const firstAmt = amts[0]?.value ?? null;
      const fromM = /(?:from|off|by)\s+(.+?)(?:\s+(?:in|over|within|across|each|every|on|at|for|then|and|to|with)\b|[,.;]|$)/i.exec(t.slice(inM.index + inM[0].length));
      const fromTxt = (fromM?.[1] ?? "").trim();
      const rel = relWord(fromTxt) ?? relWord(t) ?? "stranger";
      const count = countOf(t, "strangers?|people|friends?|customers?|clients?|payers?|senders?|transfers?|deposits?|payments?|times|top ?ups?") ?? 1;
      const perTxAmt = firstAmt;
      const total = perTxAmt != null ? perTxAmt * (count > 1 && /each|per transfer|apiece/i.test(t) ? count : 1) : null;

      const isCash = cashDeposit || /\bcash\b/i.test(t.slice(0, inM.index + 80)) && /cash\b/i.test(t);
      const isSalary = rel === "employer" || /salary|wages|payroll/i.test(t);
      const isCrypto = /crypto|bitcoin|btc\b/i.test(t);
      const isFundSell = /fund units?|sells? (?:them|units|fund)|redem/i.test(t);

      if (isFundSell && payments.some((p) => p.channel === "fund_buy")) {
        const fb = payments.filter((p) => p.channel === "fund_buy").pop()!;
        const amt = firstAmt ?? fb.amountGbp;
        const laterM =
          /(\d+|a|an|one|two|three|four|a couple of|a few)\s*(days?|weeks?)\s*(?:later|after)/i.exec(t);
        let extraDays = 7; // "sells them back" with no timing → a week on
        if (laterM) {
          const num = WORD_NUM[laterM[1].toLowerCase()] ?? (["a", "an"].includes(laterM[1]) ? 1 : parseInt(laterM[1], 10));
          extraDays = /week/i.test(laterM[2]) ? num * 7 : num;
        }
        payments.push({
          id: newPayId(), direction: "in", amountGbp: Math.round(amt * 0.9982 * 100) / 100,
          counterparty: "Harbourview Global Equity Fund (accumulation units)",
          country: "United Kingdom", channel: "fund_sell",
          day: Math.min(30, fb.day + extraDays), hour: fb.hour,
          ownAccount: false,
        });
        continue;
      }

      const n = count > 1 ? count : 1;
      const parts = total != null && count > 1 && !/each|apiece/i.test(t)
        ? splitEven(total, n)
        : Array(n).fill(perTxAmt ?? 0);
      const spread = /in a day|in one day|same day|within a day/i.test(t)
        ? 0
        : /over a week|in a week|over the week|in 7 days/i.test(t)
          ? 7
          : /over a month|in a month|over the month/i.test(t)
            ? 29
            : /over \d+ days?|in \d+ days?/i.test(t)
              ? Math.min(29, parseInt(/(?:over|in)\s+(\d+)\s*days?/i.exec(t)?.[1] ?? "7", 10))
              : 0;
      for (let i = 0; i < n; i++) {
        const amt = parts[i];
        if (!amt || amt <= 0) continue;
        const day = Math.min(30, 8 + (spread ? Math.floor((spread * i) / Math.max(1, n - 1)) : 0));
        const nm =
          rel === "own" ? customerName
          : rel === "employer" ? (activity && kind === "individual" ? `${titleCase(activity)} Employer Ltd` : "Employer Ltd")
          : rel === "solicitor" ? "Harrowgate Solicitors LLP"
          : rel === "family" ? senderName("family", i, familySurname)
          : rel === "tenant" ? `${FIRST_NAMES[(i + 5) % FIRST_NAMES.length]}`
          : rel === "business" || rel === "customer" || rel === "supplier" ? senderName("business", i, null)
          : senderName("stranger", inSeq + i, null);
        const cty = findCountry(t) ?? "United Kingdom";
        payments.push({
          id: newPayId(),
          direction: "in",
          amountGbp: amt,
          counterparty: isCash ? null : nm,
          country: cty,
          channel: isCash ? "cash" : isCrypto ? "crypto" : "bank_transfer",
          day,
          hour: 9 + i * 0.4,
          ownAccount: rel === "own",
          reference: isSalary ? "SALARY" : undefined,
        });
      }
      inSeq += n;
      if (n > 1) senderPool = { rel, count: n, total: total ?? 0 };
      lastInIdx = payments.length - 1;
      if (isCrypto) contextFlags.push("crypto counterparty");
    }

    // ---------- outgoing ----------
    const outM = OUT_VERBS.exec(t);
    // "pays in £X" is incoming, not outgoing
    const paysIn = !!outM && /^(?:pays?|paid)\s+(?:in|into)\b/i.test(t.slice(outM.index));
    // "gets paid £3,000" is also incoming — "paid" must not become an out payment
    const bePaid =
      !!outM && /^(?:pays?|paid)$/i.test(outM[0]) &&
      /(?:is|was|gets?|got|being|been)\s+$/i.test(t.slice(0, outM.index));
    if (outM && !paysIn && !bePaid && !/earns?\b/i.test(outM[0])) {
        const rest = t.slice(outM.index + outM[0].length);
        const amts = amountsIn(rest);
        const itRef = /^\s*(?:the money|the funds|it|them|that|the lot|everything|all of it)\b/i.test(rest);
        let amt: number | null = amts[0]?.value ?? null;
        if (amt == null && itRef && payments.length) {
          amt = payments.filter((p) => p.direction === "in").reduce((s2, p) => s2 + p.amountGbp, 0);
        }
        if (amt == null && senderPool && /it|money|funds|proceeds/i.test(rest)) {
          amt = senderPool.total;
        }

        const toM = /\bto\s+(.+?)(?:\s+(?:in|over|within|after|on|at|for|then|and|with)\b|[,.;]|$)/i.exec(rest);
        const toTxt = (toM?.[1] ?? "").trim();
        const country = findCountry(t);
        const rel = relWord(toTxt) ?? relWord(t);
        const isCash = /\bcash\b/i.test(rest) && /withdraw/i.test(outM[0]);
        const isCard = /\bcard\b|casino|gambl|bets?\b|restaurant|shop/i.test(rest);
        const isCrypto = /crypto|bitcoin|btc\b/i.test(rest);
        const isFundBuy = /fund units?|fund\b|units in|invest/i.test(rest);
        // "buys fund units" with no amount → subscribes the money just deposited
        if (amt == null && isFundBuy) {
          const src = lastInIdx >= 0 ? payments[lastInIdx] : [...payments].reverse().find((p) => p.direction === "in");
          amt = src?.amountGbp ?? null;
        }

        // timing after last in-payment
        let delayH = 96; // default 4 days when unspecified
        const tm =
          /(\d+|an?|one|two|three|four|five|six|seven|a couple of|a few)\s*(hours?|hrs?|days?|weeks?|minutes?|mins?)\s*(?:later|after(?:wards)?|on)/i.exec(t) ??
          /\b(an hour|within the hour|within an hour|within (?:a few )?hours?|straight away|immediately|right away|same day|next day|the next day|a day later|a week later|over a week)\b/i.exec(t);
        if (tm) {
          const tok = tm[0].toLowerCase();
          const num = tm[1] ? (WORD_NUM[tm[1].toLowerCase()] ?? (tm[1] === "a" || tm[1] === "an" ? 1 : parseInt(tm[1], 10))) : null;
          if (/within (?:a few )?hours?/.test(tok)) delayH = 2;
          else if (/an hour|within the hour|within an hour/.test(tok)) delayH = 1;
          else if (/straight away|immediately|right away/.test(tok)) delayH = 0.5;
          else if (/same day/.test(tok)) delayH = 4;
          else if (/next day|a day later/.test(tok)) delayH = 24;
          else if (/a week later|over a week/.test(tok)) delayH = 168;
          else if (num != null && /week/.test(tok)) delayH = num * 168;
          else if (num != null && /day/.test(tok)) delayH = num * 24;
          else if (num != null && /min/.test(tok)) delayH = Math.max(0.25, num / 60);
          else if (num != null) delayH = num;
        }

        const base = lastInIdx >= 0 ? payments[lastInIdx] : null;
        let day = base ? base.day : 12;
        let hour = base ? base.hour + delayH : 9;
        while (hour >= 24) { day += 1; hour -= 24; }
        if (!base && day) hour = 9;
        day = Math.min(30, Math.max(1, Math.round(day)));

        // repeated out payments in one clause? keep single.
        const destRel = isFundBuy || isCrypto ? null : rel === "own" ? "own" : rel;
        let cpName: string | null = null;
        if (isCrypto) cpName = "Cryptex Exchange Ltd";
        else if (/casino|gambl|bets?\b|bookmak/i.test(rest)) cpName = "Luckspur Casino";
        else if (isFundBuy) cpName = "Harbourview Global Equity Fund (accumulation units)";
        else if (destRel === "own") cpName = customerName;
        else if (destRel === "supplier" || destRel === "business") cpName = "Millstone Foods Ltd";
        else if (destRel === "tenant" || destRel === "family") cpName = senderName("family", 0, familySurname);
        else {
          // explicit name in "to NAME"?
          const named = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/.exec(toTxt);
          cpName = named ? named[1] : senderName("stranger", outSeq + 8, null);
        }
        const destCountry = country ?? (/own|same name/.test(toTxt) ? "United Kingdom" : country) ?? "United Kingdom";
        const isGambling = /casino|gambl|bets?\b|bookmak/i.test(rest);
        if (amt != null && amt > 0) {
          payments.push({
            id: newPayId(),
            direction: "out",
            amountGbp: amt,
            counterparty: isCash ? null : cpName,
            country: isFundBuy ? "United Kingdom" : destCountry,
            channel: isFundBuy ? "fund_buy" : isCash ? "cash" : isCard ? "card" : "bank_transfer",
            day,
            hour: Math.min(23.9, Math.round(hour * 10) / 10),
            ownAccount: !isFundBuy && destRel === "own",
          });
          outSeq++;
        }
        if (isCrypto) contextFlags.push("crypto counterparty");
        if (isGambling) contextFlags.push("gambling counterparty");
    }
  }

  // ---- flags ----
  const dormant = /\b(dormant|inactive|unused|untouched|no activity)\b.{0,40}(year|month)|\b(?:hasn't|has not|hadn't)\s+used\b/i.test(text)
    || /\bfor (?:a|an|one|two|three|\d+)\s+years?\b/i.test(lower) && /unused|dormant|inactive|untouched|quiet|hasn't used|no activity/i.test(lower)
    || /unused for|dormant for|inactive for|no activity for/i.test(lower);
  const listHit =
    /internal list|watch ?list|black ?list(?:ed)?|sanction|listed party|flagged person|banned person|exited customer/i.test(text);
  const priorReview =
    /previous(?:ly)? review|already (?:cleared|closed|reviewed|checked)|cleared before|reviewed before|cleared last|cleared earlier/i.test(text);
  const structuring =
    /under (?:the\s+)?(?:£?10,?000|£10k|threshold|reporting)|just under|keep .{0,20}under|below the threshold|split .{0,30}under/i.test(text);

  // ---- documents ----
  const docs: LiveDoc[] = [];
  const firstOut = payments.find((p) => p.direction === "out" && p.channel !== "fund_buy" && !p.ownAccount);
  const firstIn = payments.find((p) => p.direction === "in" && p.counterparty);
  const wantsDocNone = /\bno (?:documents?|paperwork|evidence|records|docs)\b|nothing on file|without any (?:documents?|invoice|paperwork)/i.test(text);
  if (!wantsDocNone) {
    const invM =
      /(?:with|has|have|got|there'?s)\s+(?:a\s+)?(matching\s+|mismatch\w*\s+|wrong(?:\s+amount)?\s+)?(invoice|contract|receipt|purchase order)/i.exec(text) ??
      /\b(invoice|contract|receipt)\b/i.exec(text);
    if (invM && firstOut) {
      const mismatch = /mismatch|wrong|different amount/i.test(invM[1] ?? "") || /invoice.{0,30}(different|wrong|smaller)/i.test(text);
      docs.push({
        id: newDocId(),
        type: /contract/i.test(invM[2] ?? invM[1]) ? "contract" : "invoice",
        partyName: firstOut.counterparty,
        amountGbp: null,
        matching: !mismatch,
        linkedPaymentId: firstOut.id,
        partyDob: null,
      });
    }
    if (/receivable|invoice.{0,20}(?:they|she|he|the (?:café|cafe|business|firm|company))\s+issued|bills?\s+(?:them|the payer)/i.test(text) && firstIn) {
      docs.push({
        id: newDocId(), type: "receivable", partyName: firstIn.counterparty,
        amountGbp: null, matching: true, linkedPaymentId: firstIn.id, partyDob: null,
      });
    }
    if (/payslip|pay slip|employment contract|contract of employment/i.test(text)) {
      docs.push({
        id: newDocId(), type: "employment", partyName: null,
        amountGbp: monthlyGbp, matching: true, linkedPaymentId: null, partyDob: null,
      });
    }
    const giftM = /gift (?:letter|deed|declaration)|letter (?:from|saying it'?s a gift)/i.exec(text);
    if (giftM && firstIn) {
      docs.push({
        id: newDocId(), type: "gift_letter", partyName: firstIn.counterparty,
        amountGbp: null, matching: true, linkedPaymentId: firstIn.id, partyDob: null,
      });
    }
    if (/loan (?:agreement|contract|letter)|loan doc/i.test(text) && firstIn) {
      docs.push({
        id: newDocId(), type: "loan_agreement", partyName: firstIn.counterparty,
        amountGbp: null, matching: true, linkedPaymentId: firstIn.id, partyDob: null,
      });
    }
    const stmtM = /bank statement|statement (?:from|showing|proving)|proof (?:it'?s|that it'?s)\s+\w+\s+own/i.exec(text);
    if (stmtM || (/own/i.test(text) && /statement|on file|proof/i.test(text))) {
      docs.push({
        id: newDocId(), type: "bank_statement", partyName: customerName,
        amountGbp: null, matching: true, linkedPaymentId: null, partyDob: null,
      });
    }
    const evM = /(solicitor'?s? letter|estate|inheritance|insurance (?:payout|letter)|settlement letter|sale receipt|sold (?:his|her|their|my)\s+\w+)/i.exec(text);
    if (evM && firstIn) {
      docs.push({
        id: newDocId(), type: "event_letter", partyName: firstIn.counterparty,
        amountGbp: null, matching: true, linkedPaymentId: firstIn.id, partyDob: null,
      });
    }
    if (/takings book|cash records|reconciliation|takings records|banked takings/i.test(text) &&
        payments.some((p) => p.channel === "cash" && p.direction === "in")) {
      docs.push({
        id: newDocId(), type: "cash_records", partyName: null,
        amountGbp: null, matching: true, linkedPaymentId: null, partyDob: null,
      });
    }
  }

  // structuring context → make cash deposits fit the band when asked
  if (structuring) {
    for (const p of payments) {
      if (p.channel === "cash" && p.direction === "in" && p.amountGbp >= 10_000) {
        p.amountGbp = 9500;
      }
    }
    contextFlags.push("amounts kept under the £10,000 cash threshold");
  }

  // list hit → pick the named counterparty (the first non-own out or in)
  let listHitCounterparty: string | null = null;
  if (listHit) {
    const tgt = payments.find((p) => p.counterparty && !p.ownAccount) ?? null;
    if (tgt) {
      listHitCounterparty = tgt.counterparty;
      contextFlags.push("counterparty matched the internal list");
    } else {
      // invent a counterparty payment on the list
      const nm = "Vernon Ashpole";
      payments.push({
        id: newPayId(), direction: "in", amountGbp: 4200,
        counterparty: nm, country: "United Kingdom",
        channel: "bank_transfer", day: 11, hour: 10, ownAccount: false,
      });
      listHitCounterparty = nm;
      notes.push("Added a £4,200 payment from the listed party so the list match has something to bite on.");
    }
  }

  let priorReviewCounterparty: string | null = null;
  if (priorReview) {
    const tgt = payments.find((p) => p.counterparty && !p.ownAccount) ?? null;
    if (tgt) priorReviewCounterparty = tgt.counterparty;
  }

  if (payments.length === 0) {
    notes.push("Could not find a payment in that description — try naming an amount and what happened to it.");
    // a tiny default so the card isn't empty
    payments.push({
      id: newPayId(), direction: "in", amountGbp: 1000,
      counterparty: senderName("stranger", 0, null),
      country: "United Kingdom", channel: "bank_transfer",
      day: 10, hour: 9, ownAccount: false,
    });
  }

  const { inst } = guessInstitution(text, kind, { out: payments.filter((p) => p.direction === "out") });
  if (/abroad|overseas|out of the country/i.test(text) &&
      !payments.some((p) => p.country !== "United Kingdom" && p.direction === "out")) {
    const out = payments.find((p) => p.direction === "out");
    if (out) out.country = "United Arab Emirates";
  }

  const scenario = normalizeScenario({
    institution: inst,
    institutionAuto: true,
    customerKind: kind,
    customerName,
    activity,
    monthlyGbp,
    expectedCountries: ["United Kingdom"],
    employer: null,
    payments,
    docs,
    priorReviewCounterparty,
    listHitCounterparty,
    dormant,
    contextFlags,
    sourceText: text,
  });
  return { scenario, parser: "local", notes };
}

export function isHighRisk(country: string): boolean {
  return HIGH_RISK_SET.some((c) => c.toLowerCase() === country.toLowerCase());
}
