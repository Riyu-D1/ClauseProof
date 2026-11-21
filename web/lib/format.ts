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

const FLAGS: Record<string, string> = {
  "United Kingdom": "🇬🇧",
  "United States": "🇺🇸",
  Canada: "🇨🇦",
  France: "🇫🇷",
  Germany: "🇩🇪",
  Italy: "🇮🇹",
  Spain: "🇪🇸",
  Portugal: "🇵🇹",
  Netherlands: "🇳🇱",
  Poland: "🇵🇱",
  Turkey: "🇹🇷",
  India: "🇮🇳",
  China: "🇨🇳",
  "Hong Kong": "🇭🇰",
  Japan: "🇯🇵",
  Vietnam: "🇻🇳",
  Australia: "🇦🇺",
  Mexico: "🇲🇽",
  "United Arab Emirates": "🇦🇪",
  Afghanistan: "🇦🇫",
  Belarus: "🇧🇾",
  "Democratic Republic of the Congo": "🇨🇩",
  Haiti: "🇭🇹",
  Iran: "🇮🇷",
  Iraq: "🇮🇶",
  Lebanon: "🇱🇧",
  Libya: "🇱🇾",
  Mali: "🇲🇱",
  Myanmar: "🇲🇲",
  "North Korea": "🇰🇵",
  Russia: "🇷🇺",
  Somalia: "🇸🇴",
  "South Sudan": "🇸🇸",
  Syria: "🇸🇾",
  Venezuela: "🇻🇪",
  Yemen: "🇾🇪",
};

export const flag = (country: string | null | undefined) =>
  (country && FLAGS[country]) || "🏳";

export const VERDICT_COLOR: Record<string, string> = {
  CLOSE: "#2BD47D",
  RFI: "#FFB020",
  ESCALATE: "#FF3B5C",
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
