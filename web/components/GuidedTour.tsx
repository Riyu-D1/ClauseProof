"use client";

import { AnimatePresence, motion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const SEEN_KEY = "cp_tour_v1";
const STEP_MS = 6500;

interface Step {
  title: string;
  body: string;
  /** static route, or "CASE" = resolved to a real case id at open time */
  route: string;
}

const STEPS: Step[] = [
  {
    route: "/",
    title: "The story",
    body: "Transaction-monitoring alerts bury analysts. A wrong CLOSE is the costliest mistake, so ClauseProof decides every alert against the institution's own written policy — and shows the clause and evidence behind it.",
  },
  {
    route: "/queue",
    title: "The alert queue",
    body: "All 4,000 development cases the organisers supplied — fictional customers, transactions and documents. Every verdict you see was computed by the engine, none was typed in.",
  },
  {
    route: "CASE",
    title: "One case, decided",
    body: "The money-flow graph on the left, the policy checks the engine ran on the right. Press DECIDE LIVE to re-run the engine on this case in front of you.",
  },
  {
    route: "/live",
    title: "Try it live",
    body: "Describe any customer and what their money did. A parser fills an editable scenario card, the monitoring rules fire honestly, and the same deterministic engine decides — in seconds.",
  },
  {
    route: "/stage",
    title: "Beat the Analyst",
    body: "The party trick: the audience invents a launderer on their phones and the engine judges it live on this board. When you're done, the PROOF page shows why the verdicts can be trusted.",
  },
];

async function resolveCaseStep(): Promise<Step> {
  const step = STEPS[2];
  try {
    const demo = await fetch("/data/demo.json", { cache: "no-store" }).then((r) =>
      r.ok ? r.json() : null
    );
    const id = demo?.picks?.[0]?.case_id;
    if (id) return { ...step, route: `/case/${id}` };
    const bank = await fetch("/data/bank.json", { cache: "no-store" }).then((r) =>
      r.ok ? r.json() : null
    );
    if (bank?.[0]?.case_id) return { ...step, route: `/case/${bank[0].case_id}` };
  } catch {
    /* fall through */
  }
  return { ...step, route: "/queue" };
}

export default function GuidedTour() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(0);
  const [steps, setSteps] = useState<Step[]>(STEPS);
  const [manual, setManual] = useState(false);
  const timer = useRef<number | null>(null);
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

  const close = useCallback(() => {
    setOpen(false);
    try {
      localStorage.setItem(SEEN_KEY, "done");
    } catch {
      /* private mode */
    }
  }, []);

  const start = useCallback(async () => {
    setManual(false);
    setIdx(0);
    setSteps(STEPS);
    setOpen(true);
    if (pathnameRef.current !== STEPS[0].route) router.push(STEPS[0].route);
    const resolved = await resolveCaseStep();
    setSteps((s) => s.map((x, i) => (i === 2 ? resolved : x)));
  }, [router]);

  // auto-open once, on the overview
  useEffect(() => {
    let seen = true;
    try {
      seen = !!localStorage.getItem(SEEN_KEY);
    } catch {
      /* private mode */
    }
    if (!seen && pathname === "/") {
      const t = setTimeout(() => void start(), 700);
      return () => clearTimeout(t);
    }
  }, [pathname, start]);

  // "?" button in the nav re-opens the tour
  useEffect(() => {
    const onOpen = () => void start();
    window.addEventListener("cp:open-tour", onOpen);
    return () => window.removeEventListener("cp:open-tour", onOpen);
  }, [start]);

  // navigate when the step changes
  useEffect(() => {
    if (!open) return;
    const step = steps[idx];
    if (step && step.route !== "CASE" && pathnameRef.current !== step.route) {
      router.push(step.route);
    }
  }, [idx, open, steps, router]);

  // auto-advance until the visitor takes over
  useEffect(() => {
    if (!open || manual) return;
    timer.current = window.setTimeout(() => {
      setIdx((i) => {
        if (i >= steps.length - 1) {
          setOpen(false);
          try {
            localStorage.setItem(SEEN_KEY, "done");
          } catch {
            /* private mode */
          }
          return i;
        }
        return i + 1;
      });
    }, STEP_MS);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [open, manual, idx, steps.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") {
        setManual(true);
        setIdx((i) => Math.min(i + 1, steps.length - 1));
      }
      if (e.key === "ArrowLeft") {
        setManual(true);
        setIdx((i) => Math.max(i - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close, steps.length]);

  const step = steps[idx];
  const last = idx === steps.length - 1;

  return (
    <AnimatePresence>
      {open && step && (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 14 }}
          transition={{ duration: 0.25 }}
          role="dialog"
          aria-label={`Tour step ${idx + 1} of ${steps.length}: ${step.title}`}
          className="fixed bottom-4 right-4 z-[80] w-[380px] max-w-[calc(100vw-2rem)] rounded-lg border border-line-2 bg-obsidian-900 p-5 shadow-2xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {steps.map((_, i) => (
                <span
                  key={i}
                  className="h-[5px] w-[5px] rounded-full"
                  style={{ background: i === idx ? "var(--color-accent)" : "var(--color-line-2)" }}
                />
              ))}
            </div>
            <span className="mono text-[9.5px] tracking-[0.14em] text-ink-500">
              {idx + 1} / {steps.length}
            </span>
          </div>
          <p className="doto text-[20px] leading-none text-ink-100">{step.title}</p>
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-300">{step.body}</p>
          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={close}
              className="mono text-[10px] tracking-[0.12em] text-ink-500 transition-colors hover:text-ink-100"
            >
              SKIP TOUR
            </button>
            <div className="flex items-center gap-1.5">
              {idx > 0 && (
                <button
                  onClick={() => {
                    setManual(true);
                    setIdx((i) => Math.max(0, i - 1));
                  }}
                  className="mono rounded-md border border-line px-2.5 py-1.5 text-[10px] text-ink-400 transition-colors hover:border-line-2 hover:text-ink-100"
                >
                  ←
                </button>
              )}
              <button
                onClick={() => {
                  setManual(true);
                  if (last) close();
                  else setIdx((i) => i + 1);
                }}
                className="mono rounded-md border border-accent bg-accent px-3 py-1.5 text-[10px] font-bold tracking-[0.12em] text-obsidian-950 transition-opacity hover:opacity-90"
              >
                {last ? "DONE — SEE PROOF ↑" : "NEXT →"}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
