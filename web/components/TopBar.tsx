import Link from "next/link";
import { VERDICT_COLOR } from "@/lib/format";
import type { Verdict } from "@/lib/types";

export function FixtureBadge() {
  return (
    <span
      className="mono inline-flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-bold tracking-[0.14em]"
      style={{ color: "#ffb224", border: "1px dashed #ffb22466" }}
      title="Demo data generated from real case files — the engine's traces are not yet wired in"
    >
      [ FIXTURE DATA ]
    </span>
  );
}

export default function TopBar({ fixture }: { fixture: boolean }) {
  return (
    <header className="relative z-10 flex h-14 items-center justify-between border-b border-line px-6">
      <Link href="/" className="group flex items-center gap-3.5">
        <span
          className="doto flex h-8 w-8 items-center justify-center rounded-md border border-line-2 text-[13px] text-accent transition-colors group-hover:border-accent"
          aria-hidden
        >
          C
        </span>
        <span className="flex flex-col leading-none">
          <span className="text-[15px] font-semibold tracking-tight text-ink-100">
            ClauseProof
          </span>
          <span className="mono mt-1 text-[9.5px] uppercase tracking-[0.2em] text-ink-500">
            Alert triage console
          </span>
        </span>
      </Link>
      <div className="flex items-center gap-4">
        {fixture && <FixtureBadge />}
        {/* verdict vocabulary — live legend, colour only carries meaning */}
        <div className="hidden items-center gap-4 sm:flex" aria-label="verdict legend">
          {(["CLOSE", "RFI", "ESCALATE"] as Verdict[]).map((v) => (
            <span key={v} className="flex items-center gap-1.5">
              <span
                className="inline-block h-[5px] w-[5px] rounded-full"
                style={{ background: VERDICT_COLOR[v] }}
              />
              <span className="mono text-[10px] tracking-[0.16em] text-ink-400">{v}</span>
            </span>
          ))}
        </div>
      </div>
    </header>
  );
}
