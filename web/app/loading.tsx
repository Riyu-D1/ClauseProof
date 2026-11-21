export default function Loading() {
  return (
    <div className="relative z-10 mx-auto flex min-h-screen max-w-[1400px] flex-col items-center justify-center">
      <p className="mono text-[12px] tracking-[0.22em] text-ink-500">
        <span className="cp-dots">[ LOADING QUEUE</span>
        <span> ]</span>
      </p>
    </div>
  );
}
