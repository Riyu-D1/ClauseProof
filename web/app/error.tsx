"use client";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="relative z-10 mx-auto flex min-h-screen max-w-[1400px] flex-col items-center justify-center p-10">
      <div className="panel max-w-md p-8 text-center">
        <p className="mono text-[11px] tracking-[0.2em] text-escalate">[ CONSOLE FAULT ]</p>
        <h2 className="mt-2 text-lg font-semibold text-ink-100">Something broke on render</h2>
        <p className="mono mt-3 break-words text-[10.5px] leading-relaxed text-ink-500">
          {error.message || "unknown error"}
          {error.digest ? ` · ${error.digest}` : ""}
        </p>
        <button
          onClick={reset}
          className="mono mt-5 rounded-lg border border-accent/60 bg-accent/10 px-4 py-2 text-[12px] font-bold tracking-wide text-accent transition-colors hover:bg-accent/20"
        >
          ⟳ RETRY
        </button>
      </div>
    </main>
  );
}
