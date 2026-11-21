import Link from "next/link";

export function FixtureBadge() {
  return (
    <span
      className="mono inline-flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-[10px] font-semibold tracking-widest"
      style={{ color: "#ffb020", borderColor: "#ffb02088", background: "#ffb02010" }}
      title="Demo data generated from real case files — the engine's traces are not yet wired in"
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#ffb020" }} />
      FIXTURE DATA
    </span>
  );
}

export default function TopBar({ fixture }: { fixture: boolean }) {
  return (
    <header className="relative z-10 flex items-center justify-between border-b border-white/[0.06] px-5 py-3">
      <Link href="/" className="group flex items-center gap-3">
        <span
          className="mono flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold"
          style={{
            background: "linear-gradient(135deg, #37e0d820, #37e0d808)",
            border: "1px solid #37e0d840",
            color: "#37e0d8",
          }}
        >
          CP
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-[15px] font-semibold tracking-tight text-ink-100">
            ClauseProof
          </span>
          <span className="mono text-[10px] uppercase tracking-[0.18em] text-ink-500">
            Alert triage console
          </span>
        </span>
      </Link>
      <div className="flex items-center gap-3">
        {fixture && <FixtureBadge />}
        <span className="mono hidden text-[10px] tracking-wider text-ink-600 sm:block">
          CLOSE · RFI · ESCALATE
        </span>
      </div>
    </header>
  );
}
