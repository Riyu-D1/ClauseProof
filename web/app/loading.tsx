export default function Loading() {
  return (
    <div className="relative z-10 mx-auto flex min-h-screen max-w-[1400px] flex-col">
      <div className="border-b border-white/[0.06] px-5 py-3">
        <div className="h-8 w-44 animate-pulse rounded-lg bg-white/[0.05]" />
      </div>
      <div className="flex flex-col gap-5 p-5">
        <div className="panel h-[76px] animate-pulse" />
        <div className="flex gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="panel h-[58px] w-[150px] animate-pulse" />
          ))}
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="panel h-[64px] animate-pulse" style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    </div>
  );
}
