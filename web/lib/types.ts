// Shared trace contract — engine writes, web reads.

export type Verdict = "CLOSE" | "RFI" | "ESCALATE";

export interface TraceCustomer {
  id: string;
  name: string;
  kind: string;
  occupation_or_activity: string | null;
  declared_monthly_gbp: number | null;
  expected_countries: string[];
  // optional extras (present in fixture traces; UI tolerates absence)
  risk_rating?: string | null;
  address?: string | null;
  onboarded_on?: string | null;
  account_purpose?: string | null;
  source_of_funds?: string | null;
  expected_channels?: string[];
  held_payment_id?: string | null;
  review_window?: { from: string; to: string };
}

export interface TraceAlert {
  alert_id: string;
  rule_id: string;
  rule_name: string;
  message: string;
  transaction_ids: string[];
}

export interface CoverageRow {
  transaction_id: string;
  amount_gbp: number;
  direction: "in" | "out";
  counterparty: string;
  country: string;
  booked_at: string;
  covered_by: string | null;
  why: string;
}

// a slice of coverage rows shown as a list in the evidence drawer
// (click a graph node or edge chip to open it)
export interface TxListing {
  title: string;
  sub?: string;
  rows: CoverageRow[];
  heldId?: string | null;
}

export interface CheckStep {
  step: number;
  policy_clause: string;
  question: string;
  result: "PASS" | "FAIL" | "UNKNOWN";
  evidence: string[];
}

export interface Flip {
  change: string;
  new_verdict: Verdict;
}

export interface Trace {
  case_id: string;
  institution: string;
  customer: TraceCustomer;
  verdict: Verdict;
  reason_code: string;
  reason: string;
  evidence: string[];
  alerts: TraceAlert[];
  coverage: CoverageRow[];
  checks: CheckStep[];
  flip: Flip | null;
  risk_context: string[];
  engine_version: string;
  input_hash: string;
  grok?: {
    docs: Record<string, {
      assisted_by: "grok";
      cache_key: string;
      note: string | null;
    }>;
    rules: Record<string, {
      assisted_by: "grok";
      cache_key: string;
      measures: string;
      threshold_gbp: number | null;
      window_days: number | null;
      typical_risk: string;
    }>;
  } | null;
}

export interface Manifest {
  generated_at: string;
  fixture: boolean;
  trace_source?: string;
  institutions: { id: string; cases: number; verdicts?: Record<Verdict, number> }[];
  repro: boolean;
  total_cases: number;
}

export interface DemoPick {
  slot: "close_invoice" | "rfi" | "mule" | "held_fx" | "tm22";
  label: string;
  blurb: string;
  institution: string;
  case_id: string;
  verdict: Verdict;
  reason_code: string;
  customer_name?: string;
  flagged_gbp: number;
  txns: number;
  counterparties: number;
  unexplained: number;
  has_flip: boolean;
}

export interface Demo {
  generated_at: string;
  picks: DemoPick[];
}

export interface Repro {
  fixture?: boolean;
  runs?: number;
  identical_verdicts?: boolean;
  identical_reason_codes?: boolean;
  note?: string;
}

export const INSTITUTION_LABEL: Record<string, string> = {
  bank: "Bank",
  emoney: "E-Money",
  investment: "Investment",
  payments_fx: "Payments & FX",
};
