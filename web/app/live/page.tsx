import LiveClient from "@/components/LiveClient";
import TopBar from "@/components/TopBar";
import { configuredLlmTag } from "@/lib/live-llm";

export const dynamic = "force-dynamic";

export default function LivePage() {
  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-[1500px] flex-col">
      <TopBar fixture={false} />
      {/* which parser the toggle offers — never the key itself */}
      <LiveClient llmTag={configuredLlmTag()} />
    </main>
  );
}
