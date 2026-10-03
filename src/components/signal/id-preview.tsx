"use client";

import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { PreviewResult } from "@/server/actions/evidence";

type State<T> = { status: "idle" | "loading" } | { status: "done"; result: PreviewResult<T> };

/**
 * A clickable readable ID (R-042, I-07, US-012) whose preview is loaded from the server the
 * first time the popover opens (SPEC §12.1: every ID opens a preview).
 */
export function IdPreview<T>({
  id,
  load,
  render,
  prefix,
  className,
  contentClassName,
}: {
  id: string;
  load: (id: string) => Promise<PreviewResult<T>>;
  render: (data: T) => React.ReactNode;
  prefix?: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  const [state, setState] = useState<State<T>>({ status: "idle" });

  function fetchPreview() {
    setState({ status: "loading" });
    load(id)
      .then((result) => setState({ status: "done", result }))
      .catch(() => setState({ status: "done", result: { ok: false, reason: "erreur" } }));
  }

  return (
    <Popover
      onOpenChange={(open) => {
        const failed = state.status === "done" && !state.result.ok;
        if (open && (state.status === "idle" || failed)) fetchPreview();
      }}
    >
      <PopoverTrigger
        className={cn(
          "inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md whitespace-nowrap border border-border bg-background px-1.5 font-mono text-[13px] leading-none font-medium text-foreground tabular-nums transition-colors hover:border-signal/50 hover:bg-signal-soft focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none data-popup-open:border-signal/60 data-popup-open:bg-signal-soft",
          className,
        )}
      >
        {prefix}
        {id}
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("w-96 gap-3 p-3.5 text-sm", contentClassName)}>
        <PreviewBody id={id} state={state} render={render} onRetry={fetchPreview} />
      </PopoverContent>
    </Popover>
  );
}

function PreviewBody<T>({
  id,
  state,
  render,
  onRetry,
}: {
  id: string;
  state: State<T>;
  render: (data: T) => React.ReactNode;
  onRetry: () => void;
}) {
  if (state.status !== "done") {
    return (
      <div className="flex flex-col gap-2" aria-busy="true" aria-label={`Chargement de ${id}`}>
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    );
  }
  if (state.result.ok) return render(state.result.data);
  if (state.result.reason === "introuvable") {
    return <p className="text-muted-foreground">{id} n&apos;existe pas (ou plus) en base.</p>;
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <p className="text-destructive">Impossible de charger {id}.</p>
      <button
        type="button"
        onClick={onRetry}
        className="text-sm font-medium underline underline-offset-4"
      >
        Réessayer
      </button>
    </div>
  );
}
