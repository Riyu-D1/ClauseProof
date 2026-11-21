import Link from "next/link";
import PageCaption from "@/components/PageCaption";
import CaseBoard from "@/components/CaseBoard";
import { findCase, getManifest } from "@/lib/server-data";

export const dynamic = "force-dynamic";

export default async function CasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const manifest = getManifest();
  const found = findCase(id);
  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-[1600px] flex-col">
      <PageCaption>
        One case file — the money-flow graph, the policy checks the engine ran,
        and the evidence each verdict rests on. Press DECIDE LIVE to re-run the
        engine on this case in front of you.
      </PageCaption>
      {found ? (
        <CaseBoard
          trace={found.trace}
          precomputedAt={manifest?.generated_at ?? null}
          peers={found.peers.map((t) => ({
            case_id: t.case_id,
            verdict: t.verdict,
            name: t.customer.name,
          }))}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center p-10">
          <div className="panel max-w-md p-8 text-center">
            <p className="mono text-[11px] tracking-[0.2em] text-ink-500">404</p>
            <h2 className="mt-2 text-lg font-semibold text-ink-100">Case not found</h2>
            <p className="mt-2 text-sm text-ink-300">
              <code className="mono text-accent">{id}</code> is not in the loaded traces.
            </p>
            <Link
              href="/queue"
              className="mono mt-4 inline-block rounded-lg border border-line-2 px-4 py-2 text-[12px] text-ink-100 transition-colors hover:border-accent"
            >
              ← Back to queue
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
