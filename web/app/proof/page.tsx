import PageCaption from "@/components/PageCaption";
import MarkdownBlock from "@/components/MarkdownBlock";
import ProofRunPanel from "@/components/ProofRunPanel";
import { getProofData } from "@/lib/proof-data";
import { INSTITUTION_LABEL } from "@/lib/types";

export const dynamic = "force-dynamic";

const CARD = "panel flex flex-col gap-3 p-5";

export default async function ProofPage() {
  const data = await getProofData();

  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-[1400px] flex-col">
      <PageCaption>
        Why the verdicts can be trusted — reproducibility, contract validation
        and an independent-label check. Every number on this page comes from a
        real run on this machine; nothing is example data.
      </PageCaption>

      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        {/* what is actually being claimed */}
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3" aria-label="What is proven">
          <div className={CARD}>
            <span className="label">What is proven</span>
            <h2 className="doto text-[20px] leading-tight text-ink-100">
              SAME EVIDENCE → SAME ANSWER
            </h2>
            <p className="text-[12.5px] leading-relaxed text-ink-300">
              Run the engine five times on the same files and every output byte
              is identical — the same verdict, the same reason code, the same
              evidence list, in the same order. That is determinism, and it is a
              property of how the engine is built: pure Python stdlib, no clock,
              no RNG, every iteration sorted.
            </p>
          </div>
          <div className={CARD}>
            <span className="label">Why it matters</span>
            <h2 className="doto text-[20px] leading-tight text-ink-100">
              THE AUDIT TRAIL REGULATORS EXPECT
            </h2>
            <p className="text-[12.5px] leading-relaxed text-ink-300">
              A decision you cannot reproduce is a decision you cannot defend.
              Each ClauseProof verdict names the policy clause it applied and
              the evidence IDs it relied on — and re-running the file produces
              exactly that decision again, so an auditor always sees what the
              analyst saw.
            </p>
          </div>
          <div className={CARD}>
            <span className="label">Why not just an LLM</span>
            <h2 className="doto text-[20px] leading-tight text-ink-100">
              A MODEL CANNOT PROMISE THIS
            </h2>
            <p className="text-[12.5px] leading-relaxed text-ink-300">
              A language model samples tokens — two calls can honestly differ,
              even at temperature 0 across providers and versions. The verdict
              here never touches a model: the only LLM anywhere near this app is
              an optional text parser on /live, and it never decides anything.
            </p>
          </div>
        </section>

        {/* live proof */}
        <ProofRunPanel />

        {/* stored proof — check_repro + output hashes + input hashes */}
        <section className="panel flex flex-col gap-4 p-5" aria-label="Stored reproducibility proof">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="label">Stored proof — system/check_repro.sh</span>
            {data.repro.generated_at && (
              <span className="mono text-[9.5px] text-ink-500">
                measured {new Date(data.repro.generated_at).toLocaleString("en-GB")}
                {data.engine_version ? ` · engine ${data.engine_version}` : ""}
              </span>
            )}
          </div>
          {!data.repro.present ? (
            <p className="mono text-[10.5px] tracking-[0.1em] text-ink-500">
              [ NOT MEASURED — run <span className="text-ink-300">bash system/check_repro.sh</span> to produce output/repro.json ]
            </p>
          ) : (
            <>
              <p className="text-[12px] leading-relaxed text-ink-400">
                {data.repro.method}
              </p>
              <div className="flex flex-col gap-1.5">
                {data.outputs.map((o) => (
                  <div
                    key={o.institution}
                    className="mono flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line bg-obsidian-900 px-3 py-2 text-[10.5px]"
                  >
                    <span className="w-28 shrink-0 font-bold text-ink-100">
                      {(INSTITUTION_LABEL[o.institution] ?? o.institution).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-ink-300" title={o.repro_sha256 ?? ""}>
                      {o.repro_sha256 ?? "—"}
                    </span>
                    <span className="shrink-0 text-ink-500">
                      {o.cases?.toLocaleString("en-GB") ?? "?"} cases
                    </span>
                    {o.output_matches != null && (
                      <span
                        className="shrink-0 font-bold"
                        style={{ color: o.output_matches ? "#38d07d" : "#ff5566" }}
                        title={
                          o.output_matches
                            ? "output/<inst>.jsonl still hashes to the 5-run fingerprint"
                            : "output file changed since the repro run"
                        }
                      >
                        {o.output_matches ? "output file matches ✓" : "output file changed ✗"}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div className="flex flex-col gap-1 border-t border-line pt-3">
                <span className="label">Input fingerprints (sha256 of each institution&apos;s case files)</span>
                {data.outputs.map((o) => (
                  <p key={o.institution} className="mono text-[9.5px] leading-relaxed text-ink-500">
                    <span className="inline-block w-28 text-ink-400">
                      {(INSTITUTION_LABEL[o.institution] ?? o.institution).toUpperCase()}
                    </span>
                    {o.input_hash ?? "—"}
                  </p>
                ))}
                <p className="mono mt-1 text-[9px] leading-relaxed text-ink-600">
                  Same inputs → same outputs: these hash the customers, transactions,
                  alerts and documents the engine reads. The hashes above fingerprint
                  what it wrote.
                </p>
              </div>
            </>
          )}
        </section>

        {/* contract validation — re-run live on the stored outputs */}
        <section className="panel flex flex-col gap-4 p-5" aria-label="Output contract validation">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="label">Output contract — system/validate.py, run just now</span>
            <span className="mono text-[9.5px] text-ink-500">
              legal verdict/reason-code pairs · 2–4 sentence reasons · every evidence ID exists
            </span>
          </div>
          {!data.validation_ran ? (
            <p className="mono text-[10.5px] tracking-[0.1em] text-ink-500">
              [ NOT RUN — validator or output files missing on this host ]
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
              {data.validation.map((v) => (
                <div
                  key={v.institution}
                  className="mono flex items-center justify-between gap-2 rounded-md border border-line bg-obsidian-900 px-3 py-2.5 text-[10.5px]"
                >
                  <span className="font-bold text-ink-100">
                    {(INSTITUTION_LABEL[v.institution] ?? v.institution).toUpperCase()}
                  </span>
                  {v.errors === 0 ? (
                    <span className="text-close">
                      {v.lines?.toLocaleString("en-GB")} lines · 0 errors ✓
                    </span>
                  ) : (
                    <span className="text-escalate">{v.raw || "failed"}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* blind-label evaluation — clearly marked as our own labels */}
        <section className="panel flex flex-col gap-4 p-5" aria-label="Blind-label evaluation">
          <div>
            <span className="label">Does it decide well? — blind-label check</span>
            <p className="mono mt-2 inline-block rounded border border-rfi/50 bg-rfi/10 px-2 py-1 text-[9.5px] font-bold tracking-[0.1em] text-rfi">
              OUR OWN INDEPENDENT LABELS — NOT OFFICIAL HACKATHON RESULTS
            </p>
          </div>
          {data.eval_blind_md ? (
            <MarkdownBlock>{data.eval_blind_md}</MarkdownBlock>
          ) : (
            <p className="mono text-[10.5px] tracking-[0.1em] text-ink-500">
              [ docs/eval_blind.md not present ]
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
