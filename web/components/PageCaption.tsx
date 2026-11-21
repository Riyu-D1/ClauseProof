/** One-line caption at the top of each page: what it does and why it matters. */
export default function PageCaption({ children }: { children: React.ReactNode }) {
  return (
    <p className="mono border-b border-line px-4 py-2 text-[10px] leading-relaxed tracking-[0.08em] text-ink-500 sm:px-6">
      {children}
    </p>
  );
}
