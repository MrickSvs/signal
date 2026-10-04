"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { PrioritizationActionResult } from "@/server/actions/prioritization";

/** Runs one write of the Priorisation screen; refreshes on success, keeps the error otherwise. */
export function usePrioritizationWrite() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const run = (call: () => Promise<PrioritizationActionResult>, onDone?: () => void) =>
    startTransition(async () => {
      setError(null);
      setWarning(null);
      const response = await call();
      if (!response.ok) {
        setError(response.message);
        return;
      }
      setWarning(response.result.warning);
      onDone?.();
      router.refresh();
    });
  return { pending, error, warning, run, setError };
}

export const FIELD =
  "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm tabular-nums";
export const LABEL = "text-[13px] font-medium text-muted-foreground";
