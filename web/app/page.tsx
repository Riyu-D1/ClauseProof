import Link from "next/link";
import PageCaption from "@/components/PageCaption";
import { sampleEngineTiming } from "@/lib/case-run";
import { VERDICT_COLOR, gbpShort } from "@/lib/format";
import { getManifest, getTraces } from "@/lib/server-data";
import { INSTITUTION_LABEL, type Verdict } from "@/lib/types";

export const dynamic = "force-dynamic";

const VERDICTS: Verdict[] = ["CLOSE", "RFI", "ESCALATE"];

const CTA_CLS =
  "group panel panel-hover flex flex-col gap-3 p-5 transition-colors hover:border-accent";

export default async function OverviewPage() {
  const manifest = getManifest();
  const timing = await sampleEngineTiming();

  const stats = (manifest?.institutions ?? []).map((inst) => {
    const traces = getTraces(inst.id);
    const alerts = traces.reduce((s, t) => s + t.alerts.length, 0);
    const flagged = traces.reduce(
      (s, t) => s + t.coverage.reduce((s2, c) => s2 + c.amount_gbp, 0),
      0
    );
    return { ...inst, alerts, flagged };
  });
  const totalCases = stats.reduce((s, i) => s + i.cases, 0);
  const totalAlerts = stats.reduce((s, i) => s + i.alerts, 0);
  const totalFlagged = stats.reduce((s, i) => s + i.flagged, 0);
  const noData = !manifest || totalCases === 0;

  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-[1400px] flex-col">
      <PageCaption>
        The whole story in one screen — what ClauseProof decides, why it can be
        trusted, and where to push on it.
      </PageCaption>

      {noData ? (
        <div className="flex flex-1 items-center justify-center p-10">
          <div className="panel max-w-md p-8 text-center">
            <p className="mono text-[11px] tracking-[0.2em] text-ink-500">[ NO DATA ]</p>
            <h2 className="mt-2 text-lg font-semibold text-ink-100">No traces loaded yet</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-300">
              Run <code className="mono text-accent">node scripts/import-traces.mjs</code>{" "}
              inside <code className="mono text-accent">web/</code> to import the
              engine&apos;s traces, or <code className="mono text-accent">./start.sh</code>{" "}
              from the repo root to do everything.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
          {/* the story: problem → product → promise */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <section className="panel flex flex-col p-6" aria-label="The problem">
              <span className="label">The problem</span>
              <h1 className="doto mt-3 text-[34px] leading-[1.05] text-ink-100">
                ALERTS BURY
                <br />
                ANALYSTS.
              </h1>
              <p className="mt-4 text-[13.5px] leading-relaxed text-ink-300">
                Every UK firm must review each alert its transaction-monitoring
                rules raise. Most turn out to be explainable — but each one still
                needs a person to read the file and decide.
              </p>
              <p className="mt-3 text-[13.5px] leading-relaxed text-ink-300">
                A <span className="font-semibold text-close">CLOSE</span> on a case
                that needed an <span className="font-semibold text-rfi">RFI</span>{" "}
                or an{" "}
                <span className="font-semibold text-escalate">ESCALATE</span> is the
                costliest mistake there is — scored 10 against 3 for being too
                cautious. That asymmetry is what ClauseProof is built around.
              </p>
            </section>

            <section className="panel flex flex-col p-6" aria-label="The product">
              <span className="label">The product</span>
              <h2 className="doto mt-3 text-[34px] leading-[1.05] text-accent">
                THE POLICY IS
                <br />
                THE ENGINE.
              </h2>
              <div className="mt-4 flex flex-col gap-3.5">
                {[
                  [
                    "01",
                    "Decides every alert against the institution's own written SOP — CLOSE, RFI or ESCALATE — never vibes.",
                  ],
                  [
                    "02",
                    "Cites the policy clause and the exact evidence IDs relied on, and shows the one change that would flip the verdict.",
                  ],
                  [
                    "03",
                    "Deterministic by construction: pure stdlib, no clock, no RNG — the same evidence always gets the same answer.",
                  ],
                ].map(([n, t]) => (
                  <div key={n} className="flex gap-3">
                    <span className="doto text-[15px] leading-snug text-accent">{n}</span>
                    <p className="text-[12.5px] leading-relaxed text-ink-300">{t}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel flex flex-col p-6" aria-label="Measured on this host">
              <span className="label">Measured — not marketing</span>
              <div className="mt-4 flex flex-col gap-4">
                <div>
                  <div className="flex items-baseline gap-2">
                    <span className="doto text-[38px] leading-none text-ink-100">
                      {totalCases.toLocaleString("en-GB")}
                    </span>
                    <span className="label">cases decided</span>
                  </div>
                  <p className="mono mt-1 text-[10px] text-ink-500">
                    {totalAlerts.toLocaleString("en-GB")} alerts · {gbpShort(totalFlagged)}{" "}
                    under review · the organisers&apos; dev set
                  </p>
                </div>
                <div className="border-t border-line pt-4">
                  {timing.available && timing.mean_ms != null ? (
                    <>
                      <div className="flex items-baseline gap-2">
                        <span className="doto text-[38px] leading-none text-ink-100">
                          {timing.mean_ms.toLocaleString("en-GB")}
                          <span className="text-[18px] text-ink-400">ms</span>
                        </span>
                        <span className="label">mean decide time</span>
                      </div>
                      <p className="mono mt-1 text-[10px] leading-relaxed text-ink-500">
                        {timing.note} — measured just now,{" "}
                        {new Date(timing.measured_at).toLocaleTimeString("en-GB")}
                      </p>
                    </>
                  ) : (
                    <p className="mono text-[10.5px] leading-relaxed text-ink-500">
                      [ ENGINE TIMING UNAVAILABLE — {timing.note ?? "no dataset on this host"} ]
                    </p>
                  )}
                </div>
                <div className="border-t border-line pt-4">
                  <p className="mono text-[10.5px] leading-relaxed text-ink-500">
                    Verdicts below pre-computed{" "}
                    {manifest.generated_at
                      ? `at ${new Date(manifest.generated_at).toLocaleString("en-GB")}`
                      : "earlier"}{" "}
                    by the same engine you can re-run live on any case.
                  </p>
                </div>
              </div>
            </section>
          </div>

          {/* per-institution split — real counts from output/traces */}
          <section
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
            aria-label="Verdict split per institution"
          >
            {stats.map((inst) => {
              const v = inst.verdicts ?? { CLOSE: 0, RFI: 0, ESCALATE: 0 };
              return (
                <div key={inst.id} className="panel flex flex-col gap-2.5 p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="mono text-[11px] font-bold tracking-[0.14em] text-ink-100">
                      {(INSTITUTION_LABEL[inst.id] ?? inst.id).toUpperCase()}
                    </span>
                    <span className="mono text-[10px] text-ink-500">
                      {inst.cases.toLocaleString("en-GB")} cases
                    </span>
                  </div>
                  <div
                    className="flex h-[8px] w-full gap-[2px]"
                    role="img"
                    aria-label={`verdict split — close ${v.CLOSE}, rfi ${v.RFI}, escalate ${v.ESCALATE}`}
                  >
                    {VERDICTS.map((k) => (
                      <div
                        key={k}
                        className="h-full"
                        style={{ flex: `${v[k]} 1 0`, background: VERDICT_COLOR[k] }}
                      />
                    ))}
                  </div>
                  <div className="flex justify-between">
                    {VERDICTS.map((k) => (
                      <span key={k} className="mono text-[9.5px]" style={{ color: VERDICT_COLOR[k] }}>
                        {k[0]}
                        {k === "RFI" ? "FI" : ""} {v[k].toLocaleString("en-GB")}
                      </span>
                    ))}
                  </div>
                  <p className="mono text-[9.5px] text-ink-600">
                    {inst.alerts.toLocaleString("en-GB")} alerts · {gbpShort(inst.flagged)} flagged
                  </p>
                </div>
              );
            })}
          </section>

          {/* three ways in */}
          <section className="grid grid-cols-1 gap-3 pb-6 md:grid-cols-3" aria-label="Ways in">
            <Link href="/queue" className={CTA_CLS}>
              <span className="doto text-[20px] text-ink-100">OPEN THE QUEUE →</span>
              <span className="text-[12.5px] leading-relaxed text-ink-300">
                Browse all {totalCases.toLocaleString("en-GB")} decisions — filter
                by institution or verdict, open any case file.
              </span>
              <span className="mono mt-auto text-[9.5px] tracking-[0.14em] text-ink-500 group-hover:text-accent">
                THE ANALYST&apos;S VIEW
              </span>
            </Link>
            <Link href="/live" className={CTA_CLS}>
              <span className="doto text-[20px] text-ink-100">TRY IT LIVE →</span>
              <span className="text-[12.5px] leading-relaxed text-ink-300">
                Describe a customer and their money — the real engine fires the
                rules and decides in front of you.
              </span>
              <span className="mono mt-auto text-[9.5px] tracking-[0.14em] text-ink-500 group-hover:text-accent">
                NOTHING PRESET
              </span>
            </Link>
            <Link href="/proof" className={CTA_CLS}>
              <span className="doto text-[20px] text-ink-100">SEE THE PROOF →</span>
              <span className="text-[12.5px] leading-relaxed text-ink-300">
                5-run byte-identical reproducibility, contract validation and a
                blind-label evaluation — every number from a real run.
              </span>
              <span className="mono mt-auto text-[9.5px] tracking-[0.14em] text-ink-500 group-hover:text-accent">
                WHY YOU CAN TRUST IT
              </span>
            </Link>
          </section>
        </div>
      )}
    </main>
  );
}
