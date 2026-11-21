export default function Loading() {
  return (
    <div className="relative z-10 mx-auto flex h-screen max-w-[1600px] flex-col overflow-hidden">
      <div className="border-b border-white/[0.06] px-5 py-3">
        <div className="h-8 w-44 animate-pulse rounded-lg bg-white/[0.05]" />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="panel h-[44px] w-[420px] animate-pulse" />
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[290px_minmax(0,1fr)_360px]">
          <div className="panel animate-pulse" />
          <div className="panel animate-pulse" />
          <div className="panel animate-pulse" />
        </div>
        <div className="panel h-[52px] animate-pulse" />
      </div>
    </div>
  );
}
