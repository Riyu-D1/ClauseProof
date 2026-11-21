import PageCaption from "@/components/PageCaption";
import QueueClient from "@/components/QueueClient";
import { getDemo, getManifest } from "@/lib/server-data";

export const dynamic = "force-dynamic";

export default function QueuePage() {
  const manifest = getManifest();
  const demo = getDemo();
  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-[1400px] flex-col">
      <PageCaption>
        These are the organisers&apos;{" "}
        {manifest?.total_cases?.toLocaleString("en-GB") ?? "4,000"} fictional cases
        (customers, transactions, documents). Every verdict was made by our engine —
        re-run any case live from its page.
      </PageCaption>
      <QueueClient manifest={manifest} demo={demo} />
    </main>
  );
}
