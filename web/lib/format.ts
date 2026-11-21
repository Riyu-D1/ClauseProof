export const gbp = (n: number | null | undefined, dp = 2) =>
  n == null
    ? "—"
    : `£${Number(n).toLocaleString("en-GB", {
        minimumFractionDigits: dp,
        maximumFractionDigits: dp,
      })}`;

export const gbpShort = (n: number | null | undefined) => {
  if (n == null) return "—";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `£${(n / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `£${(n / 1_000).toFixed(1)}k`;
  return gbp(n, 0);
};

// ISO-2 codes — rendered as mono tags, no emoji
const ISO2: Record<string, string> = {
  "United Kingdom": "GB",
  "United States": "US",
  Canada: "CA",
  France: "FR",
  Germany: "DE",
  Italy: "IT",
  Spain: "ES",
  Portugal: "PT",
  Netherlands: "NL",
  Poland: "PL",
  Turkey: "TR",
  India: "IN",
  China: "CN",
  "Hong Kong": "HK",
  Japan: "JP",
  Vietnam: "VN",
  Australia: "AU",
  Mexico: "MX",
  "United Arab Emirates": "AE",
  Afghanistan: "AF",
  Belarus: "BY",
  "Democratic Republic of the Congo": "CD",
  Haiti: "HT",
  Iran: "IR",
  Iraq: "IQ",
  Lebanon: "LB",
  Libya: "LY",
  Mali: "ML",
  Myanmar: "MM",
  "North Korea": "KP",
  Russia: "RU",
  Somalia: "SO",
  "South Sudan": "SS",
  Syria: "SY",
  Venezuela: "VE",
  Yemen: "YE",
};

export const ccode = (country: string | null | undefined) =>
  (country && ISO2[country]) || "??";

export const VERDICT_COLOR: Record<string, string> = {
  CLOSE: "#38D07D",
  RFI: "#FFB224",
  ESCALATE: "#FF5566",
};

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

export const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};

export const fmtDateTime = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};

export const pct = (part: number, total: number) =>
  total === 0 ? 0 : Math.round((part / total) * 100);
