// "Flip it" — one-click scenario edits generated from what the engine
// found unexplained. Each flip mutates the scenario card and re-runs the
// real engine; nothing here promises a verdict, the engine decides again.

import {
  newDocId,
  newPayId,
  splitEven,
  type LiveDoc,
  type LiveDocType,
  type LivePayment,
  type LiveScenario,
} from "./live-scenario.ts";
import { LIST_ENTRY_DOB } from "./live-case.ts";
import type { LiveResult } from "./live-run.ts";
import { gbp } from "./format.ts";

export interface LiveFlip {
  id: string;
  label: string;
  detail: string;
  apply: (s: LiveScenario) => LiveScenario;
}

const clone = (s: LiveScenario): LiveScenario => ({
  ...s,
  payments: s.payments.map((p) => ({ ...p })),
  docs: s.docs.map((d) => ({ ...d })),
  expectedCountries: [...s.expectedCountries],
  contextFlags: [...s.contextFlags],
});

const mkDoc = (partial: Omit<LiveDoc, "id" | "matching" | "partyDob"> &
               Partial<LiveDoc>): LiveDoc => ({
  id: newDocId(),
  matching: true,
  partyDob: null,
  ...partial,
});

const DOC_LABEL: Record<LiveDocType, string> = {
  invoice: "invoice",
  contract: "contract",
  receivable: "sales invoice",
  employment: "employment contract",
  bank_statement: "bank statement",
  gift_letter: "gift letter",
  loan_agreement: "loan agreement",
  cash_records: "takings book",
  event_letter: "solicitor/event letter",
  register: "company register extract",
};

/** Map each transaction id back to its payment via the returned map. */
export function suggestFlips(s: LiveScenario, r: LiveResult): LiveFlip[] {
  const flips: LiveFlip[] = [];
  const txnToPayment = new Map<string, LivePayment>();
  for (const p of s.payments) {
    const tid = r.paymentTxnMap[p.id];
    if (tid) txnToPayment.set(tid, p);
  }
  const uncovered = (r.trace?.coverage ?? [])
    .filter((c) => !c.covered_by)
    .map((c) => txnToPayment.get(c.transaction_id))
    .filter((p): p is LivePayment => !!p);
  const seenPay = new Set<string>();

  for (const p of uncovered) {
    if (seenPay.has(p.id)) continue;
    seenPay.add(p.id);
    const cp = p.counterparty;
    if (p.direction === "out" && cp && !p.ownAccount && p.channel !== "card" && p.channel !== "fund_buy") {
      flips.push({
        id: `inv-${p.id}`,
        label: `add a matching invoice for ${gbp(p.amountGbp, 0)} to ${cp}`,
        detail: "documents the payment — the engine re-checks coverage",
        apply: (sc) => {
          const n = clone(sc);
          n.docs.push(mkDoc({
            type: "invoice", partyName: cp, amountGbp: null,
            linkedPaymentId: p.id,
          }));
          return n;
        },
      });
    } else if (p.direction === "out" && p.ownAccount) {
      flips.push({
        id: `stmt-${p.id}`,
        label: "add a bank statement proving the other account is theirs",
        detail: "own-name transfers only count as own-account when a document proves it",
        apply: (sc) => {
          const n = clone(sc);
          n.docs.push(mkDoc({
            type: "bank_statement", partyName: n.customerName,
            amountGbp: null, linkedPaymentId: null,
          }));
          return n;
        },
      });
    } else if (p.direction === "in" && p.channel === "cash") {
      if (s.customerKind === "business") {
        flips.push({
          id: `cash-${p.id}`,
          label: `add a takings book reconciling the ${gbp(p.amountGbp, 0)} cash`,
          detail: "cash banking records reconcile deposits to takings",
          apply: (sc) => {
            const n = clone(sc);
            n.docs.push(mkDoc({
              type: "cash_records", partyName: null,
              amountGbp: null, linkedPaymentId: null,
            }));
            return n;
          },
        });
      } else {
        flips.push({
          id: `cash-${p.id}`,
          label: `add a document explaining the ${gbp(p.amountGbp, 0)} cash`,
          detail: "e.g. a sale receipt or solicitor letter naming the source",
          apply: (sc) => {
            const n = clone(sc);
            n.docs.push(mkDoc({
              type: "event_letter", partyName: null,
              amountGbp: p.amountGbp, linkedPaymentId: null,
            }));
            return n;
          },
        });
      }
    } else if (p.direction === "in" && cp) {
      const isPerson = !/\b(ltd|llp|plc|llc|inc|foods|supplies|trading|solicitors|services|group|partners)\b/i.test(cp);
      if (isPerson) {
        flips.push({
          id: `gift-${p.id}`,
          label: `add a gift letter for the ${gbp(p.amountGbp, 0)} from ${cp}`,
          detail: "a signed gift letter documents a third-party payer",
          apply: (sc) => {
            const n = clone(sc);
            n.docs.push(mkDoc({
              type: "gift_letter", partyName: cp, amountGbp: null,
              linkedPaymentId: p.id,
            }));
            return n;
          },
        });
      } else {
        const type: LiveDocType = s.customerKind === "business" ? "receivable" : "event_letter";
        flips.push({
          id: `doc-${p.id}`,
          label: `add a document explaining the ${gbp(p.amountGbp, 0)} from ${cp}`,
          detail: type === "receivable"
            ? "a sales invoice the customer issued to the payer"
            : "a solicitor/event letter naming the payer",
          apply: (sc) => {
            const n = clone(sc);
            n.docs.push(mkDoc({
              type, partyName: cp, amountGbp: null,
              linkedPaymentId: p.id,
            }));
            return n;
          },
        });
      }
    }
  }

  // ---- TM22 ----
  if (s.listHitCounterparty && r.verdict !== "NO_ALERT") {
    const cp = s.listHitCounterparty;
    const isPerson = !/\b(ltd|llp|plc|llc|inc|solicitors|partners|group)\b/i.test(cp);
    if (isPerson) {
      flips.push({
        id: "dob-different",
        label: `prove ${cp} is a different person (DoB document)`,
        detail: "a document carrying a different date of birth clears the list match",
        apply: (sc) => {
          const n = clone(sc);
          n.docs.push(mkDoc({
            type: "gift_letter", partyName: cp, amountGbp: 1500,
            linkedPaymentId: null, partyDob: "1988-11-03",
          }));
          return n;
        },
      });
      flips.push({
        id: "dob-same",
        label: `…or confirm it IS the listed ${cp.split(" ")[0]} (same DoB)`,
        detail: "same date of birth as the list entry — expect escalation",
        apply: (sc) => {
          const n = clone(sc);
          n.docs.push(mkDoc({
            type: "gift_letter", partyName: cp, amountGbp: 1500,
            linkedPaymentId: null, partyDob: LIST_ENTRY_DOB,
          }));
          return n;
        },
      });
    }
  }

  // ---- timing ----
  const ins = s.payments.filter((p) => p.direction === "in");
  const fastOuts = s.payments.filter((p) => {
    if (p.direction !== "out" || p.channel === "fund_buy") return false;
    return ins.some((i) => {
      const dh = (p.day - i.day) * 24 + (p.hour - i.hour);
      return dh >= 0 && dh <= 48;
    });
  });
  if (fastOuts.length && r.verdict !== "NO_ALERT") {
    const p = fastOuts[0];
    flips.push({
      id: `slow-${p.id}`,
      label: `slow it down — send the ${gbp(p.amountGbp, 0)} a week later instead`,
      detail: "breaks the 48-hour pass-through pattern",
      apply: (sc) => {
        const n = clone(sc);
        const t = n.payments.find((x) => x.id === p.id);
        if (t) { t.day = Math.min(30, t.day + 7); t.hour = 9; }
        return n;
      },
    });
  }

  // ---- mismatched doc ----
  const bad = s.docs.find((d) => !d.matching);
  if (bad) {
    flips.push({
      id: "fix-doc",
      label: `fix the ${DOC_LABEL[bad.type]} to the amount actually paid`,
      detail: "a mismatched document is worse than none",
      apply: (sc) => {
        const n = clone(sc);
        const d = n.docs.find((x) => x.id === bad.id);
        if (d) d.matching = true;
        return n;
      },
    });
  }

  // ---- remove a deciding document (when it closed) ----
  if (r.verdict === "CLOSE" && s.docs.length) {
    for (const d of s.docs.slice(0, 2)) {
      flips.push({
        id: `drop-${d.id}`,
        label: `remove the ${DOC_LABEL[d.type]}`,
        detail: "see what happens when the evidence isn't on file",
        apply: (sc) => {
          const n = clone(sc);
          n.docs = n.docs.filter((x) => x.id !== d.id);
          return n;
        },
      });
    }
  }

  // ---- no alert: things that WOULD have made the rules look ----
  if (r.verdict === "NO_ALERT") {
    const firstIn = s.payments.find((p) => p.direction === "in");
    if (firstIn) {
      flips.push({
        id: "crowd-7",
        label: `make it 7 different people paying in instead`,
        detail: "more than 6 counterparties trips the many-to-one rule",
        apply: (sc) => {
          const n = clone(sc);
          const src = n.payments.find((p) => p.id === firstIn.id);
          if (!src) return n;
          const amts = splitEven(src.amountGbp, 7);
          const keep = n.payments.filter((p) => p.id !== firstIn.id);
          const made = amts.map((a, i) => ({
            ...src,
            id: newPayId(),
            amountGbp: a,
            counterparty: `Sender ${String.fromCharCode(65 + i)} ${["Alderton","Bexley","Callow","Dewhurst","Evershot","Fennick","Greycliff"][i]}`,
            hour: 9 + i * 0.5,
          }));
          n.payments = [...made, ...keep].sort(
            (a, b) => a.day - b.day || a.hour - b.hour
          );
          return n;
        },
      });
    }
    const lastIn = ins[ins.length - 1];
    const anyOut = s.payments.find((p) => p.direction === "out");
    if (lastIn && !anyOut) {
      flips.push({
        id: "pass-through",
        label: `send it all out to a stranger an hour later`,
        detail: "money in and straight out is what the rules watch for",
        apply: (sc) => {
          const n = clone(sc);
          const total = n.payments
            .filter((p) => p.direction === "in")
            .reduce((x, p) => x + p.amountGbp, 0);
          n.payments.push({
            id: newPayId(), direction: "out", amountGbp: total,
            counterparty: "Rory Fenwick", country: "United Kingdom",
            channel: "bank_transfer", day: lastIn.day,
            hour: Math.min(23, lastIn.hour + 1), ownAccount: false,
          });
          return n;
        },
      });
    }
    flips.push({
      id: "russia-6k",
      label: `send £6,000 to an undeclared high-risk country`,
      detail: "trips the higher-risk corridor rule (TM06)",
      apply: (sc) => {
        const n = clone(sc);
        n.payments.push({
          id: newPayId(), direction: "out", amountGbp: 6000,
          counterparty: "Volga Industrial Metals OOO", country: "Russia",
          channel: "bank_transfer", day: 15, hour: 11, ownAccount: false,
        });
        return n;
      },
    });
  }

  return flips.slice(0, 8);
}
