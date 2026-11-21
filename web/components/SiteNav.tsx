"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { VERDICT_COLOR } from "@/lib/format";
import type { Verdict } from "@/lib/types";

const LINKS = [
  { href: "/", label: "OVERVIEW", key: "o", match: (p: string) => p === "/" },
  {
    href: "/queue",
    label: "ALERT QUEUE",
    key: "q",
    match: (p: string) => p.startsWith("/queue") || p.startsWith("/case"),
  },
  { href: "/live", label: "TRY IT LIVE", key: "l", match: (p: string) => p.startsWith("/live") },
  {
    href: "/stage",
    label: "BEAT THE ANALYST",
    key: "s",
    match: (p: string) => p.startsWith("/stage") || p.startsWith("/play"),
  },
  { href: "/proof", label: "PROOF", key: "p", match: (p: string) => p.startsWith("/proof") },
];

export default function SiteNav() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const [fixture, setFixture] = useState(false);
  const pending = useRef<number | null>(null);

  // /play is the phone controller for Beat the Analyst — no console chrome.
  const bare = pathname.startsWith("/play");

  useEffect(() => {
    fetch("/data/manifest.json", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => setFixture(!!m?.fixture))
      .catch(() => setFixture(false));
  }, []);

  // g then a letter: g o overview · g q queue · g l live · g s stage · g p proof
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (pending.current != null) {
        const link = LINKS.find((l) => l.key === e.key.toLowerCase());
        window.clearTimeout(pending.current);
        pending.current = null;
        if (link) {
          e.preventDefault();
          router.push(link.href);
        }
        return;
      }
      if (e.key.toLowerCase() === "g") {
        pending.current = window.setTimeout(() => (pending.current = null), 1400);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  if (bare) return null;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-obsidian-950/90 backdrop-blur">
      <div className="flex h-14 items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="group flex shrink-0 items-center gap-3">
          <span
            className="doto flex h-8 w-8 items-center justify-center rounded-md border border-line-2 text-[13px] text-accent transition-colors group-hover:border-accent"
            aria-hidden
          >
            C
          </span>
          <span className="hidden flex-col leading-none sm:flex">
            <span className="text-[15px] font-semibold tracking-tight text-ink-100">
              ClauseProof
            </span>
            <span className="mono mt-1 text-[9.5px] uppercase tracking-[0.2em] text-ink-500">
              Alert triage console
            </span>
          </span>
        </Link>

        <nav
          aria-label="Sections"
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
        >
          {LINKS.map((l) => {
            const active = l.match(pathname);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                title={`${l.label} — press g then ${l.key}`}
                className={`mono whitespace-nowrap rounded-md px-2.5 py-1.5 text-[10px] font-bold tracking-[0.12em] transition-colors sm:px-3 ${
                  active
                    ? "bg-ink-100 text-obsidian-950"
                    : "text-ink-400 hover:text-ink-100"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex shrink-0 items-center gap-3">
          {fixture && (
            <span
              className="mono hidden items-center gap-1.5 rounded px-2 py-1 text-[10px] font-bold tracking-[0.14em] sm:inline-flex"
              style={{ color: "#ffb224", border: "1px dashed #ffb22466" }}
              title="Demo data generated from real case files — the engine's traces are not yet wired in"
            >
              [ FIXTURE DATA ]
            </span>
          )}
          <div className="hidden items-center gap-3 lg:flex" aria-label="verdict legend">
            {(["CLOSE", "RFI", "ESCALATE"] as Verdict[]).map((v) => (
              <span key={v} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-[5px] w-[5px] rounded-full"
                  style={{ background: VERDICT_COLOR[v] }}
                />
                <span className="mono text-[9.5px] tracking-[0.16em] text-ink-500">{v}</span>
              </span>
            ))}
          </div>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent("cp:open-tour"))}
            className="mono flex h-8 items-center rounded-md border border-line px-2.5 text-[10.5px] tracking-[0.1em] text-ink-400 transition-colors hover:border-line-2 hover:text-ink-100"
            title="Take the 30-second guided tour"
          >
            ? <span className="ml-1 hidden xl:inline">TOUR</span>
          </button>
        </div>
      </div>
    </header>
  );
}
