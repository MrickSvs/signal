"use client";

// Digest generation, live (ADR-044): « Générer » / « Régénérer » stream what Signal is doing from
// POST /api/digest. An emitter pulses while a wire of dispatches lists each real step with the
// figures it read; the digest shown dims meanwhile and refreshes in place when it is written.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CalendarRange,
  Check,
  CircleAlert,
  History,
  Layers,
  PenLine,
  Radio,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  buildGenerationLog,
  GENERATION_STEPS,
  stepsDone,
  type LogLine,
} from "@/lib/digest/generation-log";
import { decodeEvents, type DigestStreamEvent } from "@/lib/digest/stream";
import { cn } from "@/lib/utils";

type Status = "idle" | "running" | "done" | "error";

type Generation = {
  status: Status;
  /** The page had no digest when the generation started (wording of the last line). */
  first: boolean;
  lines: LogLine[];
  startedAt: number | null;
  /** The page is being refreshed with the new digest. */
  refreshing: boolean;
  start: () => void;
  dismiss: () => void;
};

const GenerationContext = createContext<Generation | null>(null);

export function useDigestGeneration(): Generation {
  const value = useContext(GenerationContext);
  if (!value) throw new Error("useDigestGeneration hors de DigestGenerationProvider");
  return value;
}

/** Wraps the Digest page, with or without a digest, so a first generation flows into the digest. */
export function DigestGenerationProvider({
  first,
  children,
}: {
  first: boolean;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [events, setEvents] = useState<DigestStreamEvent[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [firstAtStart, setFirstAtStart] = useState(first);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const busy = useRef(false);

  const start = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setEvents([]);
    setFirstAtStart(first);
    setStartedAt(Date.now());
    setStatus("running");
    const ended: { outcome: Status } = { outcome: "error" };
    const push = (event: DigestStreamEvent) => {
      if (event.type === "done") ended.outcome = "done";
      setEvents((previous) => [...previous, event]);
    };
    try {
      const response = await fetch("/api/digest", { method: "POST" });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let rest = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const decoded = decodeEvents(rest + value);
        rest = decoded.rest;
        for (const event of decoded.events) {
          if (event.type !== "progress") finished = true;
          push(event);
        }
      }
      if (!finished) push({ type: "error", message: "La connexion s'est interrompue. Réessaie." });
    } catch {
      push({ type: "error", message: "Le serveur ne répond pas. Réessaie dans un instant." });
    } finally {
      busy.current = false;
    }
    setStatus(ended.outcome);
    if (ended.outcome === "done") startRefresh(() => router.refresh());
  }, [first, router]);

  const dismiss = useCallback(() => {
    if (busy.current) return;
    setStatus("idle");
    setEvents([]);
  }, []);

  // A finished generation folds away once the new digest is on screen; an error stays.
  useEffect(() => {
    if (status !== "done" || refreshing) return;
    const timer = setTimeout(dismiss, 6000);
    return () => clearTimeout(timer);
  }, [status, refreshing, dismiss]);

  const lines = status === "idle" ? [] : buildGenerationLog(events, { first: firstAtStart });
  return (
    <GenerationContext.Provider
      value={{
        status,
        first: firstAtStart,
        lines,
        startedAt,
        refreshing,
        start: () => void start(),
        dismiss,
      }}
    >
      {children}
    </GenerationContext.Provider>
  );
}

/** The digest under a generation: dimmed and inert until the new one is on screen. */
export function DigestBody({ children }: { children: React.ReactNode }) {
  const { status, refreshing } = useDigestGeneration();
  const busy = status === "running" || refreshing;
  return (
    <motion.div
      className="flex flex-col gap-6"
      animate={{ opacity: busy ? 0.32 : 1, filter: busy ? "saturate(0.3)" : "saturate(1)" }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      aria-busy={busy}
      inert={busy}
    >
      {children}
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

/** Signal's emitter: still rings at rest, waves and a radar sweep while it works. */
export function SignalEmitter({
  active,
  size = 160,
  className,
}: {
  active: boolean;
  size?: number;
  className?: string;
}) {
  const core = Math.round(size * 0.3);
  return (
    <div
      aria-hidden
      className={cn("signal-motion relative shrink-0", className)}
      style={{ width: size, height: size }}
    >
      {[1, 0.7, 0.42].map((scale) => (
        <span
          key={scale}
          className="absolute rounded-full border border-dashed border-signal/20"
          style={{ inset: `${((1 - scale) / 2) * 100}%` }}
        />
      ))}
      {active && (
        <>
          <span
            className="absolute inset-0 rounded-full"
            style={{
              background:
                "conic-gradient(from 0deg, transparent 0deg, color-mix(in oklch, var(--signal) 26%, transparent) 46deg, transparent 72deg)",
              animation: "signal-sweep 2.8s linear infinite",
            }}
          />
          {[0, 0.85, 1.7].map((delay) => (
            <span
              key={delay}
              className="absolute inset-0 rounded-full border-2 border-signal/70"
              style={{
                animation: "signal-wave 2.55s cubic-bezier(0.2, 0.6, 0.3, 1) infinite",
                animationDelay: `${delay}s`,
              }}
            />
          ))}
        </>
      )}
      <span
        className={cn(
          "absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full",
          active
            ? "bg-signal text-signal-foreground shadow-[0_0_0_6px_var(--signal-soft)]"
            : "bg-signal-soft text-signal",
        )}
        style={{
          width: core,
          height: core,
          animation: active ? "signal-breathe 1.7s ease-in-out infinite" : undefined,
        }}
      >
        <Radio style={{ width: core * 0.46, height: core * 0.46 }} />
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rail and wire
// ---------------------------------------------------------------------------

const STEP_LABELS: Record<(typeof GENERATION_STEPS)[number], string> = {
  period: "Période",
  facts: "Faits",
  memory: "Mémoire",
  writing: "Rédaction",
  saved: "Enregistré",
};

function StepRail({ lines, status }: { lines: LogLine[]; status: Status }) {
  const done = stepsDone(lines);
  return (
    <ol className="signal-motion grid grid-cols-5 gap-1.5" aria-label="Étapes de la génération">
      {GENERATION_STEPS.map((step, index) => {
        const state =
          index < done ? "done" : index === done && status === "running" ? "active" : "todo";
        return (
          <li key={step} className="flex flex-col gap-1.5">
            <span className="relative h-1 overflow-hidden rounded-full bg-muted">
              <motion.span
                className="absolute inset-y-0 left-0 rounded-full bg-signal"
                initial={false}
                animate={{ width: state === "done" ? "100%" : state === "active" ? "45%" : "0%" }}
                transition={{ duration: 0.5, ease: [0.2, 0.7, 0.3, 1] }}
                style={{ opacity: state === "active" ? 0.55 : 1 }}
              />
            </span>
            <span
              className={cn(
                "truncate font-mono text-[11px] tracking-wide uppercase",
                state === "todo" ? "text-muted-foreground/60" : "text-foreground",
              )}
            >
              {STEP_LABELS[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const LINE_ICONS: Record<LogLine["key"], LucideIcon> = {
  connect: Radio,
  period: CalendarRange,
  facts: Layers,
  memory: History,
  writing: PenLine,
  saved: Check,
  done: Sparkles,
  error: CircleAlert,
};

const TONE_STYLES: Record<LogLine["tone"], string> = {
  done: "bg-signal-soft text-signal",
  active: "bg-signal text-signal-foreground",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
  error: "bg-destructive/10 text-destructive",
};

/** Seconds since `since`, ticking while `live`. */
function useElapsed(since: number | null, live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, [live]);
  return since === null ? 0 : Math.max(0, now - since);
}

/** Always one decimal, so the column of times stays aligned: « 5,0 s ». */
const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

/** A figure that counts up as it lands. */
function CountUp({ value }: { value: number }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (reduce) return;
    let frame = 0;
    const begin = performance.now();
    const tick = (t: number) => {
      const progress = Math.min(1, (t - begin) / 650);
      setShown(Math.round(value * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduce]);
  return <>{reduce ? value : shown}</>;
}

/** Lines being typeset: the wait while the model writes. */
function Composing() {
  return (
    <span aria-hidden className="signal-motion mt-2 flex w-full max-w-sm flex-col gap-1.5">
      {[94, 76, 86].map((width, i) => (
        <span key={width} className="h-1.5 rounded-full bg-muted" style={{ width: `${width}%` }}>
          <span
            className="block h-full origin-left rounded-full bg-signal/35"
            style={{
              animation: "signal-compose 2.4s cubic-bezier(0.45, 0, 0.2, 1) infinite",
              animationDelay: `${i * 0.4}s`,
            }}
          />
        </span>
      ))}
    </span>
  );
}

function GenerationLog({
  lines,
  startedAt,
  live,
}: {
  lines: LogLine[];
  startedAt: number | null;
  live: boolean;
}) {
  const elapsed = useElapsed(startedAt, live);
  return (
    <ol className="flex flex-col" aria-live="polite" aria-label="Ce que fait Signal">
      <AnimatePresence initial={false}>
        {lines.map((line, index) => {
          const Icon = LINE_ICONS[line.key];
          const last = index === lines.length - 1;
          return (
            <motion.li
              key={line.key}
              layout="position"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.2, 0.7, 0.3, 1] }}
              className="grid grid-cols-[4.25rem_1.75rem_1fr] gap-x-3"
            >
              <span className="pt-1 text-right font-mono text-[12px] text-muted-foreground tabular-nums">
                {line.at !== null
                  ? `+${seconds(line.at)}`
                  : line.tone === "active"
                    ? seconds(elapsed)
                    : ""}
              </span>
              <span className="relative flex justify-center">
                {!last && <span aria-hidden className="absolute top-7 bottom-0 w-px bg-border" />}
                <span
                  className={cn(
                    "signal-motion relative z-10 flex size-7 items-center justify-center rounded-full",
                    TONE_STYLES[line.tone],
                  )}
                >
                  {line.tone === "active" && (
                    <span
                      aria-hidden
                      className="absolute inset-0 rounded-full border-2 border-signal"
                      style={{ animation: "signal-wave 1.6s ease-out infinite" }}
                    />
                  )}
                  {line.tone === "warning" ? (
                    <TriangleAlert aria-hidden className="size-3.5" />
                  ) : (
                    <Icon aria-hidden className="size-3.5" />
                  )}
                </span>
              </span>
              <div className={cn("flex min-w-0 flex-col pb-4", last && "pb-0")}>
                <p
                  className={cn(
                    "pt-0.5 text-[14px] leading-snug",
                    line.key === "done" ? "font-semibold" : "font-medium",
                    line.tone === "error" && "text-destructive",
                  )}
                >
                  {line.title}
                  {line.tone === "active" && (
                    <span className="signal-motion ml-0.5 inline-block animate-pulse">…</span>
                  )}
                </p>
                {line.figures.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {line.figures.map((f, i) => (
                      <motion.li
                        key={f.label}
                        initial={{ opacity: 0, scale: 0.92 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ delay: 0.08 * i, duration: 0.25 }}
                        className="rounded-md border bg-background px-2 py-0.5 text-[13px]"
                      >
                        <span className="font-mono font-semibold tabular-nums">
                          <CountUp value={f.value} />
                        </span>{" "}
                        <span className="text-muted-foreground">{f.label}</span>
                      </motion.li>
                    ))}
                  </ul>
                )}
                {line.detail && (
                  <p className="mt-1 text-[13px] text-muted-foreground">{line.detail}</p>
                )}
                {line.key === "writing" && line.tone === "active" && <Composing />}
              </div>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

// ---------------------------------------------------------------------------
// The two places it shows
// ---------------------------------------------------------------------------

/** Under the header of an existing digest, while « Régénérer » runs and just after. */
export function GenerationPanel() {
  const { status, first, lines, startedAt, refreshing, dismiss, start } = useDigestGeneration();
  const running = status === "running";
  const elapsed = useElapsed(startedAt, running);
  return (
    <AnimatePresence initial={false}>
      {status !== "idle" && (
        <motion.section
          key="generation"
          aria-label="Génération du digest"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.4, ease: [0.2, 0.7, 0.3, 1] }}
          className="overflow-hidden"
        >
          <div className="relative overflow-hidden rounded-xl border bg-card">
            <div
              aria-hidden
              className="pointer-events-none absolute -top-24 -left-24 size-72 rounded-full opacity-60 blur-3xl"
              style={{ background: "radial-gradient(circle, var(--signal-soft), transparent 70%)" }}
            />
            <div className="relative flex gap-6 p-5">
              <SignalEmitter active={running} size={76} className="mt-0.5 hidden @2xl:block" />
              <div className="flex min-w-0 flex-1 flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex flex-col gap-0.5">
                    <p className="font-semibold tracking-tight">
                      {running
                        ? first
                          ? "Signal écrit ton premier digest"
                          : "Signal réécrit ton digest"
                        : status === "error"
                          ? "Le digest n'a pas été réécrit"
                          : refreshing
                            ? "Mise à jour de l'écran"
                            : "Digest à jour"}
                    </p>
                    <p className="font-mono text-[12px] text-muted-foreground tabular-nums">
                      {running
                        ? `${seconds(elapsed)} · une vingtaine de secondes`
                        : first
                          ? "écrit à partir des faits relus maintenant"
                          : "même période, faits relus maintenant"}
                    </p>
                  </div>
                  {status === "error" ? (
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={start}>
                        <RotateCcw aria-hidden />
                        Réessayer
                      </Button>
                      <Button size="icon-sm" variant="ghost" onClick={dismiss} aria-label="Fermer">
                        <X aria-hidden />
                      </Button>
                    </div>
                  ) : (
                    status === "done" &&
                    !refreshing && (
                      <Button size="icon-sm" variant="ghost" onClick={dismiss} aria-label="Fermer">
                        <X aria-hidden />
                      </Button>
                    )
                  )}
                </div>
                <StepRail lines={lines} status={status} />
                <GenerationLog lines={lines} startedAt={startedAt} live={running} />
              </div>
            </div>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
}

/** The Digest page without a digest: the emitter at rest, then at work. */
export function FirstDigest() {
  const { status, lines, startedAt, start } = useDigestGeneration();
  const working = status === "running" || status === "done";
  return (
    <div className="relative isolate flex min-h-[calc(100vh-8rem)] flex-col items-center justify-center overflow-hidden px-8 py-16">
      <div
        aria-hidden
        className="absolute inset-0 -z-10 opacity-70"
        style={{
          backgroundImage:
            "radial-gradient(circle at center, color-mix(in oklch, var(--signal) 18%, transparent) 1px, transparent 1.5px)",
          backgroundSize: "22px 22px",
          maskImage: "radial-gradient(ellipse 55% 55% at 50% 42%, black 20%, transparent 75%)",
        }}
      />
      <motion.div layout className="flex w-full max-w-xl flex-col items-center gap-8">
        <SignalEmitter active={working} size={working ? 176 : 148} />
        <AnimatePresence mode="wait" initial={false}>
          {status === "idle" ? (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
              className="flex max-w-md flex-col items-center gap-4 text-center"
            >
              <div className="flex flex-col gap-2">
                <h2 className="text-2xl font-semibold tracking-tight">Pas encore de digest</h2>
                <p className="leading-relaxed text-muted-foreground">
                  Signal relit les retours, les alertes, le classement et les décisions en attente,
                  puis rédige ce qui mérite ton attention ce matin.
                </p>
              </div>
              <Button
                size="lg"
                onClick={start}
                className="bg-signal text-signal-foreground hover:bg-signal/90"
              >
                <Radio aria-hidden />
                Générer le premier digest
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="working"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.2, 0.7, 0.3, 1] }}
              className="flex w-full flex-col gap-6"
            >
              <div className="flex flex-col items-center gap-1 text-center">
                <h2 className="text-xl font-semibold tracking-tight">
                  {status === "error"
                    ? "Le digest n'a pas pu s'écrire"
                    : "Signal prépare ton premier digest"}
                </h2>
                <p className="text-muted-foreground">
                  {status === "error"
                    ? "Rien n'a été enregistré."
                    : "Voici ce qu'il fait, étape par étape."}
                </p>
              </div>
              <div className="rounded-xl border bg-card/80 p-5 shadow-sm backdrop-blur-sm">
                <div className="flex flex-col gap-5">
                  <StepRail lines={lines} status={status} />
                  <GenerationLog lines={lines} startedAt={startedAt} live={status === "running"} />
                </div>
              </div>
              {status === "error" && (
                <div className="flex justify-center">
                  <Button variant="outline" onClick={start}>
                    <RotateCcw aria-hidden />
                    Réessayer
                  </Button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
