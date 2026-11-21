import Link from "next/link";
import TopBar from "@/components/TopBar";

export default function NotFound() {
  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-[1400px] flex-col">
      <TopBar fixture={false} />
      <div className="flex flex-1 items-center justify-center p-10">
        <div className="panel max-w-md p-8 text-center">
          <p className="doto text-[42px] leading-none text-ink-100">404</p>
          <p className="mono mt-3 text-[11px] tracking-[0.2em] text-ink-500">[ NO SIGNAL ]</p>
          <p className="mt-3 text-sm leading-relaxed text-ink-300">
            That page is not on this console. The queue has every case the engine has triaged.
          </p>
          <Link
            href="/"
            className="mono mt-5 inline-block rounded-lg border border-line-2 px-4 py-2 text-[12px] text-ink-100 transition-colors hover:border-accent"
          >
            ← Back to queue
          </Link>
        </div>
      </div>
    </main>
  );
}
