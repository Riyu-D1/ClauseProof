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
        ? "px-2 py-[3px] text-[10px]"
        : "px-2.5 py-1 text-[11px]";
  return (
    <span
      className={`mono inline-flex items-center gap-1.5 rounded font-bold tracking-[0.08em] ${pad}`}
      style={{
        color: c,
        background: `${c}12`,
        border: `1px solid ${c}55`,
      }}
    >
      <span
        className="inline-block h-[5px] w-[5px] rounded-full"
        style={{ background: c }}
      />
      {verdict}
    </span>
  );
}
