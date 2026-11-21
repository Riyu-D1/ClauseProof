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
        href="/stage"
        className="mono fixed bottom-4 right-4 z-20 rounded-full border border-accent/40 bg-obsidian-900/90 px-3.5 py-1.5 text-[10px] font-semibold tracking-wider text-accent backdrop-blur transition-colors hover:border-accent"
      >
        BEAT THE ANALYST →
      </Link>
      <QueueClient manifest={manifest} demo={demo} />
    </main>
  );
}
