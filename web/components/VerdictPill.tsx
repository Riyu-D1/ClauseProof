import { VERDICT_COLOR } from "@/lib/format";
import type { Verdict } from "@/lib/types";

export default function VerdictPill({
  verdict,
  size = "md",
}: {
  verdict: Verdict;
  size?: "sm" | "md" | "lg";
}) {
  const c = VERDICT_COLOR[verdict];
  const pad =
    size === "lg"
      ? "px-3.5 py-1.5 text-[13px]"
      : size === "sm"
        ? "px-2 py-0.5 text-[10px]"
        : "px-2.5 py-1 text-[11px]";
  return (
    <span
      className={`mono inline-flex items-center gap-1.5 rounded-full font-semibold tracking-wide ${pad}`}
      style={{
        color: c,
        background: `${c}14`,
        border: `1px solid ${c}45`,
        boxShadow: `0 0 14px ${c}22`,
      }}
    >
      <span
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: c, boxShadow: `0 0 8px ${c}` }}
      />
      {verdict}
    </span>
  );
}
