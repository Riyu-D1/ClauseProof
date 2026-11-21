import LiveClient from "@/components/LiveClient";
import TopBar from "@/components/TopBar";

export const dynamic = "force-dynamic";

export default function LivePage() {
  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-[1500px] flex-col">
      <TopBar fixture={false} />
      <LiveClient />
    </main>
  );
}
