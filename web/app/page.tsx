import Link from "next/link";
import TopBar from "@/components/TopBar";
import QueueClient from "@/components/QueueClient";
import { getDemo, getManifest } from "@/lib/server-data";

export const dynamic = "force-dynamic";

export default function QueuePage() {
  const manifest = getManifest();
  const demo = getDemo();
  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-[1400px] flex-col">
      <TopBar fixture={manifest?.fixture ?? false} />
      <Link
        href="/live"
        className="group mx-6 mt-5 flex items-center justify-between gap-4 rounded-lg border border-accent/50 bg-accent/[0.06] px-5 py-4 transition-colors hover:border-accent hover:bg-accent/[0.1]"
      >
        <span className="flex items-center gap-4">
          <span className="doto text-[22px] leading-none text-accent">TRY IT LIVE</span>
          <span className="text-[13px] leading-snug text-ink-300">
            Describe any customer and what their money did — the real engine
            parses it, fires the rules, and decides in seconds.
          </span>
        </span>
        <span className="mono shrink-0 text-[11px] font-bold tracking-[0.14em] text-accent transition-transform group-hover:translate-x-1">
          →
        </span>
      </Link>
      <Link
        href="/stage"
        className="mono fixed bottom-4 right-4 z-20 rounded-full border border-accent/40 bg-obsidian-900/90 px-3.5 py-1.5 text-[10px] font-semibold tracking-wider text-accent backdrop-blur transition-colors hover:border-accent"
      >
        BEAT THE ANALYST →
      </Link>
      <QueueClient manifest={manifest} demo={demo} />
    </main>
  );
}
