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
      <QueueClient manifest={manifest} demo={demo} />
    </main>
  );
}
