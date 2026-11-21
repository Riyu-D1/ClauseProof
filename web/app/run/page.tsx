import PageCaption from "@/components/PageCaption";
import RunClient from "@/components/RunClient";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "ClauseProof — Run your own data",
};

export default function RunPage() {
  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-[1400px] flex-col">
      <PageCaption>
        Test it on your own data — drop an institution folder exactly as the
        judges hand it over, and watch the real engine decide it five times,
        byte-identical or it tells you.
      </PageCaption>
      <RunClient />
    </main>
  );
}
