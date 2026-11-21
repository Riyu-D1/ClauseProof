import LiveClient from "@/components/LiveClient";
import PageCaption from "@/components/PageCaption";
import { configuredLlmTag } from "@/lib/live-llm";

export const dynamic = "force-dynamic";

export default function LivePage() {
  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-[1500px] flex-col">
      <PageCaption>
        Describe any customer and what their money did — a parser fills an
        editable scenario card, the monitoring rules fire honestly, and the real
        deterministic engine decides. Nothing is preset.
      </PageCaption>
      {/* which parser the toggle offers — never the key itself */}
      <LiveClient llmTag={configuredLlmTag()} />
    </main>
  );
}
