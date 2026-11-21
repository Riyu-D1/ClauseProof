// "Beat the Analyst" — shared game types, personas and input validation.
// Everything here describes a synthetic, player-made case; nothing is
// taken from the development dataset except the institution's POLICY.md
// and internal_list.jsonl, which the runner copies at play time.

export const GAME_TOTAL_GBP = 15000;

export type InstitutionId = "bank" | "emoney" | "investment" | "payments_fx";
export type Funding = "crowd" | "cash" | "own";
export type InvoiceChoice = "none" | "matching" | "mismatch";
export type Verdict = "CLOSE" | "RFI" | "ESCALATE" | "NO_ALERT";

export interface DestDef {
  id: string;
  label: string;
  hint: string;
  country: string;
  /** kind drives counterparty + channel selection */
  kind: "own" | "person" | "business" | "fund";
  payee: string;
  foreign: boolean;
}

export interface DeclaredProfile {
  source_of_funds: string;
  account_purpose: string;
  expected_countries: string[];
  expected_channels: string[];
  monthly_income_gbp: number | null;
  annual_turnover_gbp: number | null;
}

export interface CustomerFrag {
  kind: "individual" | "business";
  name: string;
  date_of_birth: string | null;
  occupation?: string | null;
  employer?: string | null;
  company_number?: string;
  incorporated_on?: string | null;
  business_activity?: string;
  address: string;
  risk_rating: string;
  declared: DeclaredProfile;
}

export interface Persona {
  id: string;
  label: string;
  blurb: string;
  institution: InstitutionId;
  institutionLabel: string;
  kind: "individual" | "business";
  /** synthetic customer record fragments */
  customer: CustomerFrag;
  declaredMonthlyGbp: number;
  funding: { id: Funding; label: string; hint: string }[];
  destinations: DestDef[];
  maxSenders: number;
}

export interface PlayInput {
  nickname: string;
  persona: string;
  funding: Funding;
  senders: number;
  roundAmounts: boolean;
  ownProof: boolean;
  hoursToMove: number; // hours between money in and money out
  parkDays: number; // investment "fund park" hold time
  destination: string; // DestDef.id
  newPayeeSameDay: boolean;
  invoice: InvoiceChoice;
  deviceId: string;
}

export const HIGH_RISK_COUNTRIES = [
  "Afghanistan", "Belarus", "Democratic Republic of the Congo", "Haiti",
  "Iran", "Iraq", "Lebanon", "Libya", "Mali", "Myanmar", "North Korea",
  "Russia", "Somalia", "South Sudan", "Syria", "Venezuela", "Yemen",
];

/* ---------------------------- personas ---------------------------------- */

const INDIVIDUAL_DECLARED = (
  income: number,
  purpose: string,
  channels: string[]
) => ({
  source_of_funds: "Salary",
  account_purpose: purpose,
  expected_countries: ["United Kingdom"],
  expected_channels: channels,
  monthly_income_gbp: income,
  annual_turnover_gbp: null,
});

export const PERSONAS: Persona[] = [
  {
    id: "teacher",
    label: "Supply teacher",
    blurb: "Current account · £2,650/month declared",
    institution: "bank",
    institutionLabel: "High-street bank",
    kind: "individual",
    declaredMonthlyGbp: 2650,
    customer: {
      kind: "individual",
      name: "Alex Marlowe",
      date_of_birth: "1989-03-14",
      occupation: "Supply teacher",
      employer: "Marrowgate Primary School",
      address: "12 Wexham Terrace, Aldcote, AL4 8QT",
      risk_rating: "Low",
      declared: INDIVIDUAL_DECLARED(2650, "Everyday banking", [
        "Card",
        "Bank transfer",
        "Direct debit",
      ]),
    },
    funding: [
      { id: "crowd", label: "Other people pay me", hint: "money arrives by bank transfer" },
      { id: "cash", label: "Cash deposits", hint: "pay in notes at branches" },
      { id: "own", label: "My other account", hint: "transfer in your own name" },
    ],
    destinations: [
      { id: "uk_other", label: "A friend in the UK", hint: "faster payment to Rory Fenwick", country: "United Kingdom", kind: "person", payee: "Rory Fenwick", foreign: false },
      { id: "uk_own", label: "My own account", hint: "an account in your name elsewhere", country: "United Kingdom", kind: "own", payee: "", foreign: false },
      { id: "eu", label: "A cousin in Spain", hint: "undeclared corridor — not on the high-risk list", country: "Spain", kind: "person", payee: "Lucia Delgado", foreign: true },
      { id: "high_risk", label: "An account in Russia", hint: "on the high-risk country list", country: "Russia", kind: "business", payee: "Volga Industrial Metals OOO", foreign: true },
    ],
    maxSenders: 12,
  },
  {
    id: "baker",
    label: "Bakery owner",
    blurb: "Payments & FX account · £240k/year declared",
    institution: "payments_fx",
    institutionLabel: "Payments & FX firm",
    kind: "business",
    declaredMonthlyGbp: 20000,
    customer: {
      kind: "business",
      name: "Marlbrook Bakehouse Ltd",
      date_of_birth: null,
      company_number: "09877123",
      incorporated_on: "2018-05-22",
      business_activity: "Bakery importing ingredients and packaging",
      address: "4 Kiln Yard, Thornbrook, TH2 9PD",
      risk_rating: "Low",
      declared: {
        source_of_funds: "Business revenue",
        account_purpose: "Paying overseas suppliers",
        expected_countries: ["United Kingdom", "France", "Poland"],
        expected_channels: ["Bank transfer from own account"],
        monthly_income_gbp: null,
        annual_turnover_gbp: 240000,
      },
    },
    funding: [
      { id: "own", label: "My own bank account", hint: "fund it like a normal client" },
      { id: "crowd", label: "Other accounts pay in", hint: "third parties fund the account" },
    ],
    destinations: [
      { id: "eu", label: "Supplier in Poland", hint: "declared corridor", country: "Poland", kind: "business", payee: "Gdansk Grain & Packaging Sp. z o.o.", foreign: true },
      { id: "tr", label: "Supplier in Türkiye", hint: "undeclared — but not high-risk", country: "Turkey", kind: "business", payee: "Bosphorus Packaging AS", foreign: true },
      { id: "high_risk", label: "Supplier in Russia", hint: "on the high-risk country list", country: "Russia", kind: "business", payee: "Volga Industrial Metals OOO", foreign: true },
      { id: "uk_own", label: "Back to my own bank", hint: "an account in the company's name", country: "United Kingdom", kind: "own", payee: "", foreign: false },
    ],
    maxSenders: 20,
  },
  {
    id: "freelancer",
    label: "Freelance designer",
    blurb: "E-money app account · £3,100/month declared",
    institution: "emoney",
    institutionLabel: "E-money firm",
    kind: "individual",
    declaredMonthlyGbp: 3100,
    customer: {
      kind: "individual",
      name: "Joss Hartley",
      date_of_birth: "1993-07-30",
      occupation: "Freelance graphic designer",
      employer: null,
      address: "88 Larchfield Road, Stancote, SC1 6HW",
      risk_rating: "Low",
      declared: INDIVIDUAL_DECLARED(3100, "Freelance income and spending", [
        "Bank top-up",
        "Card",
        "Transfers",
        "Cash top-up",
      ]),
    },
    funding: [
      { id: "crowd", label: "Other people pay me", hint: "bank top-ups from others" },
      { id: "cash", label: "Cash top-ups at shops", hint: "notes over the counter" },
      { id: "own", label: "My other account", hint: "top up in your own name" },
    ],
    destinations: [
      { id: "uk_other", label: "A friend in the UK", hint: "wallet transfer to Rory Fenwick", country: "United Kingdom", kind: "person", payee: "Rory Fenwick", foreign: false },
      { id: "uk_own", label: "My bank account", hint: "an account in your name", country: "United Kingdom", kind: "own", payee: "", foreign: false },
      { id: "eu", label: "A client in Spain", hint: "undeclared corridor — not on the high-risk list", country: "Spain", kind: "person", payee: "Lucia Delgado", foreign: true },
      { id: "high_risk", label: "An account in Russia", hint: "on the high-risk country list", country: "Russia", kind: "business", payee: "Volga Industrial Metals OOO", foreign: true },
    ],
    maxSenders: 20,
  },
  {
    id: "investor",
    label: "Retail investor",
    blurb: "Broker/fund account · £4,400/month declared",
    institution: "investment",
    institutionLabel: "Investment platform",
    kind: "individual",
    declaredMonthlyGbp: 4400,
    customer: {
      kind: "individual",
      name: "Priya Danmore",
      date_of_birth: "1985-11-02",
      occupation: "Pharmacist",
      employer: "Wexford Chemists Ltd",
      address: "31 Bellamy Row, Garworth, GW8 2BN",
      risk_rating: "Low",
      declared: INDIVIDUAL_DECLARED(4400, "Long-term investing", [
        "Bank transfer from own account",
      ]),
    },
    funding: [
      { id: "own", label: "My own bank account", hint: "deposit in your own name" },
      { id: "crowd", label: "Other people deposit", hint: "third parties fund the account" },
    ],
    destinations: [
      { id: "uk_own", label: "Withdraw to my bank", hint: "an account in your name", country: "United Kingdom", kind: "own", payee: "", foreign: false },
      { id: "uk_other", label: "Pay someone else", hint: "withdrawal to Rory Fenwick", country: "United Kingdom", kind: "person", payee: "Rory Fenwick", foreign: false },
      { id: "fund_park", label: "Park it in a fund", hint: "buy units, redeem later, then withdraw", country: "United Kingdom", kind: "fund", payee: "Harbourview Global Equity Fund (accumulation units)", foreign: false },
      { id: "high_risk", label: "Withdraw to Russia", hint: "on the high-risk country list", country: "Russia", kind: "business", payee: "Volga Industrial Metals OOO", foreign: true },
    ],
    maxSenders: 20,
  },
];

export const PERSONA_BY_ID = Object.fromEntries(
  PERSONAS.map((p) => [p.id, p])
);

/* ---------------------------- validation -------------------------------- */

const NICKNAME_RE = /^[\w .!'-]{1,18}$/u;
const DEVICE_RE = /^[\w-]{6,64}$/;

export function validateInput(raw: unknown):
  | { ok: true; input: PlayInput; persona: Persona; dest: DestDef }
  | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "bad body" };
  }
  const b = raw as Record<string, unknown>;
  const persona = PERSONA_BY_ID[String(b.persona ?? "")];
  if (!persona) return { ok: false, error: "unknown persona" };

  const funding = String(b.funding ?? "");
  if (!persona.funding.some((f) => f.id === funding)) {
    return { ok: false, error: "funding not offered for this persona" };
  }
  const dest = persona.destinations.find((d) => d.id === String(b.destination ?? ""));
  if (!dest) return { ok: false, error: "unknown destination" };

  const senders = Number(b.senders);
  if (!Number.isInteger(senders) || senders < 1 || senders > persona.maxSenders) {
    return { ok: false, error: `senders must be 1-${persona.maxSenders}` };
  }
  const hoursToMove = Number(b.hoursToMove);
  if (!Number.isFinite(hoursToMove) || hoursToMove < 6 || hoursToMove > 2400) {
    return { ok: false, error: "hours out of range" };
  }
  const parkDays = Number(b.parkDays ?? 30);
  if (!Number.isFinite(parkDays) || parkDays < 1 || parkDays > 180) {
    return { ok: false, error: "park days out of range" };
  }
  const invoice = String(b.invoice ?? "none");
  if (!["none", "matching", "mismatch"].includes(invoice)) {
    return { ok: false, error: "bad invoice choice" };
  }
  const nickname = String(b.nickname ?? "").trim();
  if (!NICKNAME_RE.test(nickname)) {
    return { ok: false, error: "nickname: 1-18 letters/digits/spaces" };
  }
  const deviceId = String(b.deviceId ?? "");
  if (!DEVICE_RE.test(deviceId)) {
    return { ok: false, error: "missing device id" };
  }
  return {
    ok: true,
    input: {
      nickname,
      persona: persona.id,
      funding: funding as Funding,
      senders,
      roundAmounts: b.roundAmounts === true,
      ownProof: b.ownProof === true,
      hoursToMove,
      parkDays,
      destination: dest.id,
      newPayeeSameDay: b.newPayeeSameDay === true,
      invoice: invoice as InvoiceChoice,
      deviceId,
    },
    persona,
    dest,
  };
}
