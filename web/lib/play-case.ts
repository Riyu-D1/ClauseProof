// Builds a synthetic, player-made case in the EXACT dataset format and
// fires alerts by applying each institution's documented TM rule
// thresholds honestly to the generated transactions.

import {
  GAME_TOTAL_GBP,
  HIGH_RISK_COUNTRIES,
  type CustomerFrag,
  type DestDef,
  type InstitutionId,
  type Persona,
  type PlayInput,
} from "./play";

/* ------------------------------ dataset rows ----------------------------- */

export interface Txn {
  transaction_id: string;
  customer_id: string;
  account_id: string;
  booked_at: string;
  direction: "in" | "out";
  channel: string;
  amount_gbp: number;
  counterparty_name: string | null;
  counterparty_account: string | null;
  counterparty_country: string;
  reference: string | null;
  location: string | null;
  currency: string;
  amount: number;
}

export interface Alert {
  alert_id: string;
  case_id: string;
  customer_id: string;
  rule_name: string;
  rule_id: string;
  created_at: string;
  message: string;
  measured: Record<string, unknown>;
  transaction_ids: string[];
}

export interface DocMeta {
  doc_id: string;
  customer_id: string;
  type: string;
  title: string;
  dated: string;
  file: string;
}

export interface SyntheticCase {
  /** folder basename — MUST equal the institution id (engine reads it) */
  institution: InstitutionId;
  files: Record<string, string>; // relative path -> file contents
  caseId: string;
  alertIds: string[];
  heldPaymentId: string | null;
  txns: Txn[];
  alerts: Alert[];
  context: string[]; // game-context flags (context, not alert triggers)
  summary: string; // one-line description of the play for leaderboards
  input: PlayInput;
}

/* ------------------------------- constants ------------------------------- */

const SENDER_NAMES = [
  "Casey Alderton", "Rowan Bexley", "Jamie Callow", "Morgan Dewhurst",
  "Taylor Evershot", "Jordan Fennick", "Sam Greycliff", "Riley Harbrook",
  "Alex Imber", "Charlie Keston", "Frankie Larch", "Drew Marley",
  "Kim Neris", "Robin Oxwick", "Ash Pennifold", "Lou Quarrie",
  "Eli Renford", "Mel Storridge", "Gail Tavener", "Kit Underhay",
];

const CASH_SPOTS = [
  "Ridgeway Convenience Store", "Halgate High Street branch",
  "Draymere News & Booze", "Collins Parade Post Office",
  "Westfield Mini Market", "Norbeck Service Station",
];

const OWN_ACCOUNT_NO = "41-27-83 90217744";
const PAYEE_ACCOUNT_NO = "63-09-18 55420136";

const RULE_NAMES: Record<string, string> = {
  TM01: "Activity exceeds the expected profile",
  TM02: "Rapid movement of funds",
  TM03: "Repeated transactions below a threshold",
  TM04: "Many-to-one or one-to-many payments",
  TM05: "Large or unexpected cash activity",
  TM06: "Unexpected higher-risk corridor",
  TM07: "Dormant account reactivation",
  TM08: "Third-party funding or payout",
  TM10: "Unusually early fund redemption",
  TM22: "Counterparty on an internal list",
};

// fixed review anchor — deterministic, inside the dataset's clock frame
const BASE = new Date("2026-10-12T09:00:00Z");
const WINDOW = { from: "2026-10-01", to: "2026-10-31" };
const OPENED_AT = "2026-11-02T06:00:00Z";
const ALERT_AT = "2026-11-01T06:00:00Z";

/* -------------------------------- helpers -------------------------------- */

const iso = (d: Date) => d.toISOString().replace(".000Z", "Z");
const addH = (d: Date, h: number) => new Date(d.getTime() + h * 3600_000);
const g2 = (n: number) => Math.round(n * 100) / 100;

const GBP = (n: number) =>
  `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const dtext = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

/** Split £15,000 into n payments. Round => clean £25 multiples on the
 * first n-1 rows, remainder last. Off => deterministic ±5% jitter. */
export function splitAmounts(total: number, n: number, round: boolean): number[] {
  if (n === 1) return [total];
  if (round) {
    const u = Math.max(25, Math.round(total / n / 25) * 25);
    const amts = Array(n - 1).fill(u);
    amts.push(total - u * (n - 1));
    return amts.map(g2);
  }
  const amts = [];
  for (let i = 0; i < n - 1; i++) {
    // deterministic wobble, ±4.8%
    const wobble = 1 + (((i * 37 + i * i * 11) % 13) - 6) / 125;
    amts.push((total / n) * wobble);
  }
  const last = total - amts.reduce((s, a) => s + a, 0);
  amts.push(last);
  return amts.map((a) => g2(a));
}

function mkTxn(
  custId: string, acctId: string, seq: number, bookedAt: Date,
  direction: "in" | "out", channel: string, amount: number,
  cpName: string | null, cpAcct: string | null, cpCountry: string,
  reference: string | null, location: string | null
): Txn {
  return {
    transaction_id: `PLAY-T${String(seq).padStart(3, "0")}`,
    customer_id: custId,
    account_id: acctId,
    booked_at: iso(bookedAt),
    direction, channel,
    amount_gbp: g2(amount),
    counterparty_name: cpName,
    counterparty_account: cpAcct,
    counterparty_country: cpCountry,
    reference,
    location,
    currency: "GBP",
    amount: g2(amount),
  };
}

/* ---------------------------- transactions ------------------------------- */

function buildTxns(
  input: PlayInput, persona: Persona, dest: DestDef,
  custId: string, acctId: string
): Txn[] {
  const inst = persona.institution;
  const cust = persona.customer as { name: string };
  const txns: Txn[] = [];
  let seq = 1;

  // ---- money in ----
  const inChannel =
    input.funding === "cash"
      ? inst === "emoney" ? "cash_topup" : "cash_deposit"
      : "faster_payment";
  const inAmounts = splitAmounts(
    GAME_TOTAL_GBP, input.funding === "own" ? 1 : input.senders, input.roundAmounts
  );
  const nIn = inAmounts.length;
  const inTimes: Date[] = [];
  for (let i = 0; i < nIn; i++) {
    const t = addH(BASE, i * 0.25); // mule burst: ~15 min apart
    inTimes.push(t);
    const isOwn = input.funding === "own";
    const isCash = input.funding === "cash";
    const cpName = isCash ? null : isOwn ? cust.name : SENDER_NAMES[i];
    const cpAcct = isCash ? null : isOwn ? OWN_ACCOUNT_NO : `1${i}-22-3${i} 4477${String(1000 + i * 137).slice(1)}`;
    const loc = isCash ? CASH_SPOTS[i % CASH_SPOTS.length] : null;
    const ref = isCash
      ? inst === "emoney" ? "CASH TOP UP" : "CASH DEPOSIT"
      : isOwn ? "TRANSFER" : inst === "investment" ? "DEPOSIT" : inst === "payments_fx" ? "FUNDS IN" : "TRANSFER";
    txns.push(mkTxn(custId, acctId, seq++, t, "in", inChannel, inAmounts[i],
      cpName, cpAcct, "United Kingdom", ref, loc));
  }
  const lastIn = inTimes[nIn - 1];

  // ---- money out ----
  const hours = input.hoursToMove;
  const outAt = addH(lastIn, hours);
  const destName = dest.kind === "own" ? cust.name : dest.payee;
  const destAcct =
    dest.kind === "own" ? OWN_ACCOUNT_NO :
    dest.kind === "fund" ? null : PAYEE_ACCOUNT_NO;

  if (dest.kind === "fund") {
    // deposit -> fund units -> (redeem after parkDays) -> withdraw to own bank
    const buyAt = addH(lastIn, 1);
    txns.push(mkTxn(custId, acctId, seq++, buyAt, "out", "fund_subscription",
      GAME_TOTAL_GBP, dest.payee, null, "United Kingdom", "FUND BUY HGE-ACC", null));
    const sellAt = addH(lastIn, input.parkDays * 24);
    txns.push(mkTxn(custId, acctId, seq++, sellAt, "in", "fund_redemption",
      GAME_TOTAL_GBP * 0.9982, dest.payee, null, "United Kingdom", "FUND SELL HGE-ACC", null));
    const wdAt = addH(sellAt, 4);
    txns.push(mkTxn(custId, acctId, seq++, wdAt, "out", "faster_payment",
      GAME_TOTAL_GBP * 0.9982, cust.name, OWN_ACCOUNT_NO, "United Kingdom", "WITHDRAWAL", null));
  } else {
    const channel =
      inst === "payments_fx" ? (dest.foreign ? "swift" : "faster_payment")
      : inst === "investment" ? "faster_payment"
      : inst === "emoney" && dest.kind === "person" ? "wallet_transfer"
      : dest.foreign ? "swift" : "faster_payment";
    const ref =
      dest.kind === "own" ? "TRANSFER"
      : inst === "payments_fx" ? "SUPPLIER PAYMENT"
      : inst === "investment" ? "WITHDRAWAL"
      : "PAYMENT";
    txns.push(mkTxn(custId, acctId, seq++, outAt, "out", channel,
      GAME_TOTAL_GBP, destName, destAcct, dest.country, ref, null));
  }
  return txns;
}

/* --------------------------------- alerts -------------------------------- */

const IN_FUNDING = new Set(["faster_payment", "swift", "bacs", "wallet_transfer", "cash_deposit", "cash_topup"]);
const TRANSFER_CH = new Set(["faster_payment", "swift", "bacs", "wallet_transfer"]);
const CASH_CH = new Set(["cash_deposit", "cash_topup"]);

interface FiredAlert {
  rule_id: string;
  message: string;
  measured: Record<string, unknown>;
  transaction_ids: string[];
}

function fireAlerts(
  persona: Persona, txns: Txn[], cust: CustomerFrag
): FiredAlert[] {
  const inst = persona.institution;
  const declared = cust.declared;
  const declaredCountries = declared.expected_countries;
  const baseline = persona.declaredMonthlyGbp;
  const custName = cust.name;
  const fired: FiredAlert[] = [];

  const deposits = txns.filter((t) => t.direction === "in" && IN_FUNDING.has(t.channel));
  const outs = txns.filter((t) => t.direction === "out");
  const received = deposits.reduce((s, t) => s + t.amount_gbp, 0);

  // ---- TM01: activity exceeds expected profile ----
  const multLimit = inst === "payments_fx" ? 2 : cust.kind === "business" ? 2 : 3;
  if (received > multLimit * baseline) {
    const multiple = Math.round((received / baseline) * 100) / 100;
    const basis =
      inst === "payments_fx"
        ? "the monthly share of the expected annual payment volume"
        : cust.kind === "business" ? "declared monthly turnover" : "declared monthly income";
    fired.push({
      rule_id: "TM01",
      message: `In the 30 days to ${WINDOW.to}, the account received ${GBP(received)}, ${multiple} times ${basis} of ${GBP(baseline)}. The limit is ${multLimit} times.`,
      measured: { received_gbp: received, baseline_gbp: baseline, multiple, limit_multiple: multLimit, window_days: 30 },
      transaction_ids: deposits.map((t) => t.transaction_id),
    });
  }

  // ---- TM02: rapid movement ----
  if (received >= 2000) {
    let depCount = deposits;
    if (inst === "payments_fx") {
      depCount = deposits.filter((t) => t.counterparty_name && t.counterparty_name !== custName);
    }
    const fxReceived = depCount.reduce((s, t) => s + t.amount_gbp, 0);
    const isOwnOnly = inst === "payments_fx" && fxReceived < 2000;
    if (!isOwnOnly) {
      // which deposits were paid out within the rule's window?
      const withinH = inst === "investment" ? 240 : 48;
      const invested = outs.filter((t) => t.channel === "fund_subscription")
        .reduce((s, t) => s + t.amount_gbp, 0);
      const pays = outs.filter((t) => t.channel !== "fund_subscription" && t.channel !== "card");
      let paidFast = 0;
      // FIFO: each deposit counts if a pooled out-payment lands in time
      let pool = pays.reduce((s, t) => s + t.amount_gbp, 0);
      for (const d of depCount) {
        const arrive = Date.parse(d.booked_at);
        // find earliest out at/after arrival
        const outAt = pays
          .map((t) => Date.parse(t.booked_at))
          .filter((x) => x >= arrive)
          .sort((a, b) => a - b)[0];
        if (pool <= 0 || outAt === undefined) break;
        if ((outAt - arrive) / 3600_000 <= withinH) {
          paidFast += Math.min(d.amount_gbp, pool);
        }
        pool -= d.amount_gbp;
      }
      paidFast = Math.min(paidFast, fxReceived);
      const share = fxReceived > 0 ? paidFast / fxReceived : 0;
      const investedShare = received > 0 ? invested / received : 0;
      const fires =
        inst === "investment"
          ? share >= 0.8 && investedShare < 0.2
          : share >= 0.8;
      if (fires && pays.length) {
        const hitIns = depCount
          .filter((d) => {
            const outAt = pays.map((t) => Date.parse(t.booked_at)).filter((x) => x >= Date.parse(d.booked_at)).sort((a, b) => a - b)[0];
            return outAt !== undefined && (outAt - Date.parse(d.booked_at)) / 3600_000 <= withinH;
          })
          .map((t) => t.transaction_id);
        const span = inst === "investment" ? "10 days" : "48 hours";
        fired.push({
          rule_id: "TM02",
          message: `In the 10 days to ${WINDOW.to}, ${GBP(fxReceived)} was received and ${GBP(paidFast)} left again within ${span} (${Math.round(share * 100)}%). The limit is 80% of money received.`,
          measured: { received_gbp: fxReceived, paid_out_gbp: paidFast, share: Math.round(share * 100) / 100, invested_gbp: invested, limit_share: 0.8, window_days: 10 },
          transaction_ids: [...hitIns, ...pays.map((t) => t.transaction_id)],
        });
      }
    }
  }

  // ---- TM03: repeated transactions just under a threshold ----
  if (inst === "bank" || inst === "emoney") {
    const lo = inst === "emoney" ? 800 : 9000;
    const hi = inst === "emoney" ? 999.99 : 9999.99;
    const limit = inst === "emoney" ? 4 : 3;
    const cashy = deposits.filter(
      (t) => CASH_CH.has(t.channel) && t.amount_gbp >= lo && t.amount_gbp <= hi
    );
    if (cashy.length >= limit) {
      const tot = cashy.reduce((s, t) => s + t.amount_gbp, 0);
      const locs = new Set(cashy.map((t) => t.location).filter(Boolean)).size;
      const what = inst === "emoney" ? "cash top-ups" : "cash deposits";
      fired.push({
        rule_id: "TM03",
        message: `In the 10 days to ${WINDOW.to}, ${cashy.length} ${what} each sat between ${GBP(lo)} and ${GBP(hi)}. The limit is ${limit - 1}.`,
        measured: { count: cashy.length, total_gbp: g2(tot), locations: locs || 1, limit_count: limit - 1, window_days: 10 },
        transaction_ids: cashy.map((t) => t.transaction_id),
      });
    }
  }
  if (inst === "payments_fx") {
    const byBene = new Map<string, Txn[]>();
    for (const t of outs) {
      if (!t.counterparty_name) continue;
      const k = t.counterparty_name;
      byBene.set(k, [...(byBene.get(k) ?? []), t]);
    }
    for (const [bene, list] of byBene) {
      const inBand = list.filter((t) => t.amount_gbp >= 9000 && t.amount_gbp <= 9999.99);
      if (inBand.length >= 3) {
        fired.push({
          rule_id: "TM03",
          message: `In the 10 days to ${WINDOW.to}, ${inBand.length} payments to ${bene} each sat between £9,000.00 and £9,999.99. The limit is 2.`,
          measured: { payments: inBand.length, beneficiary: bene, total_gbp: g2(inBand.reduce((s, t) => s + t.amount_gbp, 0)), limit_count: 2, window_days: 10 },
          transaction_ids: inBand.map((t) => t.transaction_id),
        });
      }
    }
  }

  // ---- TM04: many-to-one / one-to-many ----
  if (inst === "bank" || inst === "emoney") {
    const seen = new Map<string, Txn[]>();
    for (const t of txns) {
      if (!TRANSFER_CH.has(t.channel) || !t.counterparty_name) continue;
      if (t.counterparty_name === custName) continue;
      seen.set(t.counterparty_name, [...(seen.get(t.counterparty_name) ?? []), t]);
    }
    if (seen.size > 6) {
      const ids = [...seen.values()].flat().map((t) => t.transaction_id);
      const tot = txns.filter((t) => ids.includes(t.transaction_id) && t.direction === "in")
        .reduce((s, t) => s + t.amount_gbp, 0);
      fired.push({
        rule_id: "TM04",
        message: `In the 30 days to ${WINDOW.to}, ${seen.size} different people or companies paid the account or were paid by it, more than the limit of 6. Together they moved ${GBP(tot)}.`,
        measured: { direction: "incoming", distinct_counterparties: seen.size, limit: 6, total_gbp: g2(tot), window_days: 30 },
        transaction_ids: ids,
      });
    }
  }
  if (inst === "payments_fx") {
    const benes = new Set(
      outs.filter((t) => t.counterparty_name && t.counterparty_name !== custName)
        .map((t) => t.counterparty_name)
    );
    if (benes.size > 25) {
      const ids = outs.filter((t) => benes.has(t.counterparty_name!)).map((t) => t.transaction_id);
      fired.push({
        rule_id: "TM04",
        message: `In the 30 days to ${WINDOW.to}, the client paid ${benes.size} different beneficiaries, more than the limit of 25.`,
        measured: { direction: "outgoing", distinct_counterparties: benes.size, limit: 25, total_gbp: g2(outs.reduce((s, t) => s + t.amount_gbp, 0)), window_days: 30 },
        transaction_ids: ids,
      });
    }
  }

  // ---- TM05: large or unexpected cash ----
  if (inst === "bank" || inst === "emoney") {
    const limit = inst === "emoney" ? (cust.kind === "business" ? 5000 : 1000) : (cust.kind === "business" ? 25000 : 10000);
    const ch = inst === "emoney" ? "cash_topup" : "cash_deposit";
    for (const t of deposits) {
      if (t.channel === ch && t.amount_gbp >= limit) {
        const what = inst === "emoney" ? "cash top-up" : "cash deposit";
        fired.push({
          rule_id: "TM05",
          message: `A ${what} of ${GBP(t.amount_gbp)} was made on ${dtext(new Date(t.booked_at))}. One ${what} of ${GBP(limit)} or more needs review.`,
          measured: { amount_gbp: t.amount_gbp, limit_gbp: limit },
          transaction_ids: [t.transaction_id],
        });
        break; // one alert covers the pattern
      }
    }
  }

  // ---- TM06: unexpected higher-risk corridor ----
  {
    const hr = txns.filter((t) => {
      const c = t.counterparty_country;
      return c && HIGH_RISK_COUNTRIES.includes(c) &&
        !declaredCountries.some((d: string) => d.toLowerCase() === c.toLowerCase());
    });
    const tot = hr.reduce((s, t) => s + t.amount_gbp, 0);
    if (tot >= 5000) {
      const countries = [...new Set(hr.map((t) => t.counterparty_country))].join(", ");
      fired.push({
        rule_id: "TM06",
        message: `In the 30 days to ${WINDOW.to}, ${GBP(tot)} moved to or from ${countries}, a higher-risk country the customer did not declare. The limit is £5,000.00.`,
        measured: { total_gbp: g2(tot), countries, limit_gbp: 5000, window_days: 30 },
        transaction_ids: hr.map((t) => t.transaction_id),
      });
    }
  }

  // ---- TM08: third-party funding or payout ----
  if (inst === "investment") {
    const flows = txns.filter((t) =>
      t.amount_gbp >= 1000 && t.counterparty_name &&
      t.counterparty_name !== custName &&
      t.channel !== "fund_subscription" && t.channel !== "fund_redemption"
    );
    if (flows.length) {
      const tot = flows.reduce((s, t) => s + t.amount_gbp, 0);
      const f = flows[0];
      const dir = f.direction === "in" ? "into" : "out of";
      fired.push({
        rule_id: "TM08",
        message: `${f.counterparty_name} moved ${GBP(tot)} ${dir} the account on ${dtext(new Date(f.booked_at))}. The account holder name does not match the customer, ${custName}.`,
        measured: { flows: flows.length, total_gbp: g2(tot), limit_gbp: 1000 },
        transaction_ids: flows.map((t) => t.transaction_id),
      });
    }
  }
  if (inst === "payments_fx") {
    const flows = deposits.filter((t) =>
      t.amount_gbp >= 1000 && t.counterparty_name && t.counterparty_name !== custName
    );
    if (flows.length) {
      const tot = flows.reduce((s, t) => s + t.amount_gbp, 0);
      fired.push({
        rule_id: "TM08",
        message: `${flows.length} funding payment${flows.length > 1 ? "s" : ""} totalling ${GBP(tot)} came from accounts not in the client's name. The limit is £1,000.00 per flow.`,
        measured: { flows: flows.length, total_gbp: g2(tot), limit_gbp: 1000 },
        transaction_ids: flows.map((t) => t.transaction_id),
      });
    }
  }

  // ---- TM10: early fund redemption (investment) ----
  if (inst === "investment") {
    const buys = txns.filter((t) => t.channel === "fund_subscription");
    const sells = txns.filter((t) => t.channel === "fund_redemption");
    for (const b of buys) {
      for (const s of sells) {
        if (s.counterparty_name !== b.counterparty_name) continue;
        const days = Math.round(
          (Date.parse(s.booked_at) - Date.parse(b.booked_at)) / 86400_000
        );
        if (days >= 0 && days < 90) {
          fired.push({
            rule_id: "TM10",
            message: `Units in ${b.counterparty_name} bought on ${dtext(new Date(b.booked_at))} for ${GBP(b.amount_gbp)} were sold back on ${dtext(new Date(s.booked_at))} for ${GBP(s.amount_gbp)}, ${days} days later. The limit is 90 days.`,
            measured: { fund: b.counterparty_name, held_days: days, bought_gbp: b.amount_gbp, redeemed_gbp: s.amount_gbp, limit_days: 90 },
            transaction_ids: [b.transaction_id, s.transaction_id],
          });
        }
      }
    }
  }

  // TM07 (dormant — accounts here are active) and TM22 (internal list) are
  // applied by construction: game counterparties never match the list.
  return fired;
}

/* -------------------------------- docs ----------------------------------- */

function invoiceDoc(
  docId: string, custName: string, payee: string, amount: number, dated: Date
): { meta: DocMeta; text: string } {
  const title = `Invoice GAME/${docId.slice(-4)} from ${payee}`;
  const text = `# ${title}

**Document ID:** ${docId}
**Dated:** ${dtext(dated)}

**Bill to:** ${custName}
**Description:** Goods and services supplied
**Amount due:** ${GBP(amount)}
**Pay to:** ${payee}, account ${PAYEE_ACCOUNT_NO}
`;
  return {
    meta: { doc_id: docId, customer_id: "", type: "invoice", title, dated: dated.toISOString().slice(0, 10), file: `evidence/${docId}.md` },
    text,
  };
}

function statementDoc(
  docId: string, custName: string, amount: number, dated: Date
): { meta: DocMeta; text: string } {
  const title = `Statement from Alderbeck Savings Bank`;
  const text = `# ${title}

**Document ID:** ${docId}
**Dated:** ${dtext(dated)}

**Account holder:** ${custName}
**Bank:** Alderbeck Savings Bank
**Account:** ${OWN_ACCOUNT_NO}

${dtext(addH(dated, -30))}: transfer of ${GBP(amount)} between accounts in ${custName}'s name.
`;
  return {
    meta: { doc_id: docId, customer_id: "", type: "bank_statement", title, dated: dated.toISOString().slice(0, 10), file: `evidence/${docId}.md` },
    text,
  };
}

/* ------------------------------ build case ------------------------------- */

export function buildSyntheticCase(
  input: PlayInput, persona: Persona, dest: DestDef, seq: number
): SyntheticCase {
  const cust = persona.customer;
  const inst = persona.institution;
  const custId = "PLAY-C001";
  const acctId = "PLAY-A001";
  const caseId = `PLAY-CS${String(seq).padStart(4, "0")}`;

  const txns = buildTxns(input, persona, dest, custId, acctId);
  const fired = fireAlerts(persona, txns, cust);

  // held payment (payments_fx): an alerted outgoing payment is held
  const outIds = new Set(txns.filter((t) => t.direction === "out").map((t) => t.transaction_id));
  const held =
    inst === "payments_fx"
      ? (fired.flatMap((a) => a.transaction_ids).find((id) => outIds.has(id)) ?? null)
      : null;

  const alerts: Alert[] = fired.map((f, i) => ({
    alert_id: `PLAY-AL${String(i + 1).padStart(3, "0")}`,
    case_id: caseId,
    customer_id: custId,
    rule_name: RULE_NAMES[f.rule_id],
    rule_id: f.rule_id,
    created_at: ALERT_AT,
    message: f.message,
    measured: f.measured,
    transaction_ids: f.transaction_ids,
  }));

  // ---- evidence ----
  const docs: { meta: DocMeta; text: string }[] = [];
  const custName = cust.name;
  const outTxn = txns.find((t) => t.direction === "out" && t.channel !== "fund_subscription");
  if (input.invoice !== "none" && outTxn && dest.kind !== "fund" && dest.kind !== "own") {
    const amt =
      input.invoice === "matching"
        ? outTxn.amount_gbp
        : g2(outTxn.amount_gbp * 0.62);
    docs.push(invoiceDoc("INV-9001", custName, dest.payee, amt, addH(BASE, -14)));
  }
  const needsStatement =
    input.ownProof &&
    (input.funding === "own" || dest.kind === "own" ||
      (dest.kind === "fund" && persona.institution === "investment"));
  if (needsStatement) {
    docs.push(statementDoc("STM-9001", custName, GAME_TOTAL_GBP, addH(BASE, -40)));
  }
  for (const d of docs) d.meta.customer_id = custId;

  // ---- context flags (context, not alert triggers — policy wording) ----
  const context: string[] = [];
  if (input.roundAmounts) context.push("round amounts");
  if (input.newPayeeSameDay) context.push("recipient added the same day");
  if (input.funding === "cash" && input.senders >= 10) {
    context.push(`${input.senders} separate cash deposits`);
  }
  const summaryBits: string[] = [
    input.funding === "crowd"
      ? `${input.senders} senders × ${GBP(GAME_TOTAL_GBP / input.senders)}`
      : input.funding === "cash"
        ? `${input.senders} cash deposits`
        : "own-account funding",
    `out in ${input.hoursToMove}h`,
    dest.label.toLowerCase(),
  ];
  if (input.invoice !== "none" && dest.kind !== "own" && dest.kind !== "fund") {
    summaryBits.push(input.invoice === "matching" ? "matching invoice" : "wrong-amount invoice");
  }

  // ---- assemble files ----
  const customer = {
    kind: cust.kind,
    name: custName,
    date_of_birth: cust.date_of_birth ?? null,
    occupation: cust.occupation ?? null,
    employer: cust.employer ?? null,
    company_number: cust.company_number ?? null,
    incorporated_on: cust.incorporated_on ?? null,
    business_activity: cust.business_activity ?? null,
    address: cust.address ?? "",
    onboarded_on: "2023-06-19",
    risk_rating: cust.risk_rating ?? "Low",
    declared: cust.declared,
    customer_id: custId,
    account_ids: [acctId],
    origin: "synthetic - player-made",
  };

  const caseRow = {
    case_id: caseId,
    institution: inst,
    customer_id: custId,
    opened_at: OPENED_AT,
    review_window: { ...WINDOW },
    alert_ids: alerts.map((a) => a.alert_id),
    held_payment_id: held,
    origin: "synthetic - player-made",
  };

  const jl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : "");
  const files: Record<string, string> = {
    "cases.jsonl": jl([caseRow]),
    "alerts.jsonl": jl(alerts),
    "customers.jsonl": jl([customer]),
    "transactions.jsonl": jl(txns),
    "evidence.jsonl": jl(docs.map((d) => d.meta)),
    "previous_reviews.jsonl": "",
    "internal_list.jsonl": "@@INTERNAL_LIST@@", // copied at run time
    "POLICY.md": "@@POLICY@@",
  };
  for (const d of docs) files[d.meta.file] = d.text;

  return {
    institution: inst,
    files,
    caseId,
    alertIds: alerts.map((a) => a.alert_id),
    heldPaymentId: held,
    txns,
    alerts,
    context,
    summary: summaryBits.join(" · "),
    input,
  };
}
