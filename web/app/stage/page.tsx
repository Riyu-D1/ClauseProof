"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import FlowGraph from "@/components/FlowGraph";
import DecisionPath from "@/components/DecisionPath";
import VerdictPill from "@/components/VerdictPill";
import type { Verdict } from "@/lib/types";
import type { Attempt, Bucket } from "@/lib/play-run";

interface Feed {
  total: number;
  source?: "supabase" | "memory";
  latest: Attempt | null;
  attempts: Omit<Attempt, "trace">[];
  board: Record<Bucket, { nickname: string; summary: string; reason_code: string | null }[]>;
}

const BUCKET_STYLE: Record<Bucket, { c: string; label: string; sub: string }> = {
  "CAUGHT": { c: "#ff5566", label: "CAUGHT", sub: "escalated to the MLRO" },
  "QUESTIONED": { c: "#ffb224", label: "QUESTIONED", sub: "RFI — one document away" },
  "GOT AWAY": { c: "#38d07d", label: "GOT AWAY", sub: "closed, or never looked at" },
};

function NoAlertPill() {
  return (
    <span className="mono inline-flex items-center gap-1.5 rounded border border-close/50 bg-close/10 px-3 py-1.5 text-[13px] font-semibold tracking-wide text-close">
      <span className="inline-block h-[5px] w-[5px] rounded-full bg-close" />
      NO ALERT
    </span>
  );
}

export default function StagePage() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [playUrl, setPlayUrl] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [hosted, setHosted] = useState(false);
  const seenId = useRef<string | null>(null);
  const [runId, setRunId] = useState(0);

  const poll = useCallback(async () => {
    try {
      const r = await fetch("/api/play", { cache: "no-store" });
      const d = (await r.json()) as Feed;
      if (d.latest && d.latest.id !== seenId.current) {
        seenId.current = d.latest.id;
        setRunId((n) => n + 1);
      }
      setFeed(d);
    } catch {
      /* retry next tick */
    }
  }, []);

  useEffect(() => {
    let sb: SupabaseClient | null = null;
    fetch("/api/play/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setPlayUrl(d.playUrl);
        setHosted(!!d.hosted);
        // live leaderboard: refetch the moment any viewer's play lands
        // in public.plays (the 2s poll below stays as the fallback)
        if (d.supabase?.url && d.supabase?.key) {
          sb = createClient(d.supabase.url, d.supabase.key);
          sb.channel("cp-plays-feed")
            .on(
              "postgres_changes",
              { event: "INSERT", schema: "public", table: "plays" },
              () => void poll()
            )
            .subscribe();
        }
      })
      .catch(() => setPlayUrl(null));
    return () => {
      if (sb) void sb.removeAllChannels();
    };
  }, [poll]);

  useEffect(() => {
    if (!playUrl) return;
    QRCode.toDataURL(playUrl, { margin: 1, width: 480, color: { dark: "#eef2f8", light: "#00000000" } })
      .then(setQr)
      .catch(() => setQr(null));
  }, [playUrl]);

  useEffect(() => {
    poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [poll]);

  const latest = feed?.latest ?? null;
  const trace = latest?.trace ?? null;
  const style = latest ? BUCKET_STYLE[latest.bucket] : null;

  return (
    <main className="relative z-10 flex h-screen w-screen flex-col overflow-hidden px-6 py-4">
      {/* header */}
      <header className="flex items-center justify-between border-b border-line pb-3">
        <div className="flex items-center gap-4">
          <span className="doto flex h-10 w-10 items-center justify-center rounded-md border border-line-2 text-lg text-accent">
            CP
          </span>
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-ink-100">
              BEAT THE ANALYST
            </h1>
            <p className="mono text-[10.5px] uppercase tracking-[0.2em] text-ink-500">
              you launder · the engine decides · live
            </p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="mono text-right text-[11px] text-ink-500">
            <div><span className="doto text-[15px] text-ink-100">{feed?.total ?? 0}</span> attempts</div>
            <div className="text-ink-600">
              synthetic · player-made{feed?.source === "supabase" ? " · shared live" : ""}
            </div>
            {hosted && <div className="text-ink-600">hosted · demo subset</div>}
          </div>
        </div>
      </header>

      <div className="mt-4 flex min-h-0 flex-1 gap-4">
        {/* left rail: QR + leaderboard */}
        <aside className="flex w-[330px] shrink-0 flex-col gap-4">
          <div className="panel flex flex-col items-center gap-2.5 p-4">
            <div className="mono text-[10px] tracking-[0.22em] text-ink-500">
              SCAN TO PLAY THE LAUNDERER
            </div>
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt={playUrl ?? "play url"} className="h-[190px] w-[190px] rounded-lg" />
            ) : (
              <div className="flex h-[190px] w-[190px] items-center justify-center rounded-lg border border-line text-[11px] text-ink-500">
                loading QR…
              </div>
            )}
            <div className="mono break-all text-center text-[13px] font-semibold text-accent">
              {playUrl ?? "…"}
            </div>
          </div>

          <div className="panel flex min-h-0 flex-1 flex-col p-4">
            <div className="mono mb-3 text-[10px] tracking-[0.22em] text-ink-500">
              LEADERBOARD
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              {(["CAUGHT", "QUESTIONED", "GOT AWAY"] as Bucket[]).map((b) => {
                const s = BUCKET_STYLE[b];
                const rows = feed?.board[b] ?? [];
                return (
                  <div key={b}>
                    <div className="mono mb-1.5 flex items-center gap-2 text-[10px] font-bold tracking-wider" style={{ color: s.c }}>
                      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: s.c }} />
                      {s.label} <span className="font-normal text-ink-600">({rows.length})</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      {rows.slice(0, 8).map((r, i) => (
                        <div
                          key={`${b}-${i}`}
                          className="rounded-lg border border-line bg-obsidian-900 px-2.5 py-1.5"
                          style={i === 0 ? { borderColor: `${s.c}44` } : undefined}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-[12px] font-semibold text-ink-100">{r.nickname}</span>
                            {r.reason_code && (
                              <span className="mono shrink-0 text-[9px] text-ink-500">{r.reason_code}</span>
                            )}
                          </div>
                          <div className="truncate text-[10px] text-ink-500">{r.summary}</div>
                        </div>
                      ))}
                      {rows.length === 0 && (
                        <div className="rounded-lg border border-dashed border-line-2 px-2.5 py-2 text-[10.5px] text-ink-600">
                          {s.sub}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        {/* centre: latest attempt */}
        <section className="flex min-w-0 flex-1 flex-col gap-4">
          {!latest && (
            <div className="panel flex flex-1 flex-col items-center justify-center gap-3 p-10 text-center">
              <div className="mono text-[11px] tracking-[0.25em] text-ink-500">WAITING FOR THE FIRST LAUNDERER</div>
              <p className="max-w-[520px] text-[16px] leading-relaxed text-ink-300">
                Scan the QR code. You get <span className="font-semibold text-ink-100">£15,000 of
                scam money</span> — route it through a customer account and get it out.
                Our real triage engine reads your file and decides:
                <span className="text-close"> get away</span>,
                <span className="text-rfi"> get questioned</span>, or
                <span className="text-escalate"> get caught</span>.
              </p>
            </div>
          )}

          {latest && trace && style && (
            <>
              <div
                className="panel flex items-center justify-between gap-4 px-5 py-3"
                style={{ borderColor: `${style.c}44` }}
              >
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex flex-col">
                    <span className="mono text-[9.5px] tracking-[0.2em] text-ink-500">
                      LATEST ATTEMPT · SYNTHETIC PLAYER-MADE CASE
                    </span>
                    <span className="truncate text-[18px] font-bold text-ink-100">
                      {latest.nickname}
                      <span className="ml-2 text-[12px] font-normal text-ink-400">
                        {latest.summary}
                      </span>
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span
                    className="doto text-[24px] leading-none"
                    style={{ color: style.c }}
                  >
                    {style.label}
                  </span>
                  {latest.verdict === "NO_ALERT" ? (
                    <NoAlertPill />
                  ) : (
                    <VerdictPill verdict={latest.verdict as Verdict} />
                  )}
                </div>
              </div>

              <div className="panel min-h-0 flex-1 overflow-hidden">
                <FlowGraph
                  key={`${latest.id}-g`}
                  trace={trace}
                  onDoc={() => {}}
                  flipped={false}
                />
              </div>
            </>
          )}
        </section>

        {/* right rail: decision path + flip */}
        {latest && trace && (
          <aside className="flex w-[400px] shrink-0 flex-col gap-4">
            <div className="panel min-h-0 flex-1 overflow-hidden p-4">
              <DecisionPath key={`${latest.id}-d`} trace={trace} runId={runId} onDoc={() => {}} />
            </div>
            <div className="panel px-4 py-3">
              <div className="mono text-[9.5px] tracking-[0.2em] text-ink-500">
                {latest.bucket === "GOT AWAY" ? "WHAT WOULD HAVE CAUGHT THEM" : "WHAT WOULD HAVE GOT THEM CLOSED"}
              </div>
              {latest.flip ? (
                <p className="mt-1 text-[12.5px] text-ink-100">
                  {latest.flip.change}
                  <span className="mono ml-2 text-[10px] text-ink-500">→ {latest.flip.new_verdict}</span>
                </p>
              ) : (
                <p className="mt-1 text-[12.5px] text-ink-400">
                  {latest.verdict === "NO_ALERT"
                    ? "No alert fired — the monitoring rules never looked at this file."
                    : "No single change flips this decision."}
                </p>
              )}
              {latest.context.length > 0 && (
                <p className="mt-1.5 text-[10.5px] text-ink-500">
                  Context noted: {latest.context.join(" · ")}
                </p>
              )}
            </div>
          </aside>
        )}
      </div>
    </main>
  );
}
