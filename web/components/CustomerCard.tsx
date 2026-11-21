"use client";

import { flag, fmtDate, gbp } from "@/lib/format";
import type { Trace } from "@/lib/types";

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-[5px]">
      <span className="mono shrink-0 pt-px text-[10px] uppercase tracking-wider text-ink-600">
        {k}
      </span>
      <span className="text-right text-[12px] text-ink-100">{children}</span>
    </div>
  );
}

export default function CustomerCard({ trace }: { trace: Trace }) {
  const c = trace.customer;
  const observed = trace.coverage
    .filter((r) => r.direction === "in")
    .reduce((s, r) => s + r.amount_gbp, 0);
  const multiple =
    c.declared_monthly_gbp && c.declared_monthly_gbp > 0
      ? observed / c.declared_monthly_gbp
      : null;
  return (
    <div className="panel flex flex-col p-4">
      <div className="mono mb-2 text-[10px] tracking-[0.18em] text-ink-500">CUSTOMER</div>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-ink-100">{c.name}</div>
          <div className="mono text-[10px] text-ink-500">{c.id}</div>
        </div>
        {c.risk_rating && (
          <span
            className="mono rounded-md px-2 py-1 text-[10px] font-semibold"
            style={{
              color: c.risk_rating === "Low" ? "#2bd47d" : c.risk_rating === "Medium" ? "#ffb020" : "#ff3b5c",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            {c.risk_rating.toUpperCase()}
          </span>
        )}
      </div>
      <div className="mt-1 text-[12px] text-ink-300">
        {c.occupation_or_activity ?? "—"} · {c.kind}
      </div>

      <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/25 p-3">
        <div className="mono mb-1 text-[9.5px] tracking-[0.16em] text-ink-600">
          DECLARED vs OBSERVED
        </div>
        <Row k="declared /mo">{gbp(c.declared_monthly_gbp)}</Row>
        <Row k="flagged in">
          <span className={multiple && multiple > 1 ? "text-rfi" : ""}>{gbp(observed)}</span>
        </Row>
        {multiple != null && (
          <Row k="multiple">
            <span
              className="mono font-semibold"
              style={{ color: multiple > 2 ? "#ff3b5c" : multiple > 1 ? "#ffb020" : "#2bd47d" }}
            >
              {multiple.toFixed(1)}×
            </span>
          </Row>
        )}
      </div>

      <div className="mt-3 divide-y divide-white/[0.05]">
        {c.account_purpose && <Row k="purpose">{c.account_purpose}</Row>}
        {c.source_of_funds && <Row k="SoF">{c.source_of_funds}</Row>}
        <Row k="countries">
          <span className="flex flex-wrap justify-end gap-1">
            {c.expected_countries.map((x) => (
              <span key={x} title={x}>
                {flag(x)}
              </span>
            ))}
          </span>
        </Row>
        {c.expected_channels?.length ? (
          <Row k="channels">{c.expected_channels.join(", ")}</Row>
        ) : null}
        {c.onboarded_on && <Row k="onboarded">{fmtDate(c.onboarded_on)}</Row>}
        {c.review_window && (
          <Row k="window">
            {fmtDate(c.review_window.from)} → {fmtDate(c.review_window.to)}
          </Row>
        )}
        {c.address && <Row k="address">{c.address}</Row>}
      </div>

      {trace.risk_context.length > 0 && (
        <div className="mt-3">
          <div className="mono mb-1.5 text-[9.5px] tracking-[0.16em] text-ink-600">
            RISK CONTEXT
          </div>
          <div className="flex flex-wrap gap-1.5">
            {trace.risk_context.map((r) => (
              <span
                key={r}
                className="mono rounded-md border border-[#ffb02040] bg-[#ffb0200d] px-1.5 py-0.5 text-[10px] text-rfi"
              >
                {r}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3">
        <div className="mono mb-1.5 text-[9.5px] tracking-[0.16em] text-ink-600">
          ALERTS ({trace.alerts.length})
        </div>
        <div className="flex flex-col gap-1.5">
          {trace.alerts.map((a) => (
            <div
              key={a.alert_id}
              className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-2"
              title={a.message}
            >
              <div className="flex items-center justify-between">
                <span className="mono text-[10.5px] font-semibold text-accent">{a.rule_id}</span>
                <span className="mono text-[9.5px] text-ink-600">{a.alert_id}</span>
              </div>
              <div className="mt-0.5 text-[11px] leading-snug text-ink-300">{a.rule_name}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
