"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A backlog item folded to its summary (ADR-040): kind, id, status, judge, points and title, its
 * actions just under; the full content unfolds below. Open by default when linked to (?element=).
 */
export function ItemDisclosure({
  id,
  defaultOpen,
  summary,
  actions,
  children,
}: {
  id: string;
  defaultOpen: boolean;
  summary: React.ReactNode;
  actions: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={`${id}-body`}
          className="flex min-w-0 items-start gap-2 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              "mt-1 size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
              !open && "-rotate-90",
            )}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-1">{summary}</span>
        </button>
        <div className="flex flex-wrap items-center gap-1.5 pl-6">{actions}</div>
      </div>
      {open && (
        <div id={`${id}-body`} className="flex flex-col gap-3 border-t pt-3 pl-6">
          {children}
        </div>
      )}
    </>
  );
}
