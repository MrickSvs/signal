"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SheetSteps = { previousHref: string | null; nextHref: string | null; label: string };

/**
 * Side panel of one feedback, driven by the URL (?retour=R-042): closing it drops the param.
 * Previous and next step through the listed feedbacks, also with the ← and → keys.
 */
export function DetailSheet({
  id,
  closeHref,
  steps,
  children,
}: {
  id: string;
  closeHref: string;
  steps: SheetSteps | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const previousHref = steps?.previousHref ?? null;
  const nextHref = steps?.nextHref ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const href =
        event.key === "ArrowLeft" ? previousHref : event.key === "ArrowRight" ? nextHref : null;
      if (!href) return;
      event.preventDefault();
      router.push(href, { scroll: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previousHref, nextHref, router]);

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.push(closeHref, { scroll: false });
      }}
    >
      <SheetContent
        showCloseButton={!steps}
        className="w-[40rem] gap-0 overflow-y-auto p-0 text-[15px] data-[side=right]:sm:max-w-[40rem]"
      >
        <SheetTitle className="sr-only">Retour {id}</SheetTitle>
        {steps && (
          <nav
            aria-label="Retours de la liste"
            className="sticky top-0 z-10 flex items-center gap-1 border-b bg-background/95 px-4 py-2 backdrop-blur"
          >
            <StepLink href={previousHref} label="Retour précédent">
              <ChevronLeft aria-hidden />
            </StepLink>
            <StepLink href={nextHref} label="Retour suivant">
              <ChevronRight aria-hidden />
            </StepLink>
            <span className="ml-1 text-[13px] text-muted-foreground tabular-nums">
              {steps.label}
            </span>
            <Link
              href={closeHref}
              scroll={false}
              aria-label="Fermer"
              title="Fermer"
              className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "ml-auto")}
            >
              <X aria-hidden />
            </Link>
          </nav>
        )}
        {children}
      </SheetContent>
    </Sheet>
  );
}

function StepLink({
  href,
  label,
  children,
}: {
  href: string | null;
  label: string;
  children: React.ReactNode;
}) {
  const className = cn(buttonVariants({ variant: "outline", size: "icon-sm" }));
  return href ? (
    <Link href={href} scroll={false} aria-label={label} title={label} className={className}>
      {children}
    </Link>
  ) : (
    <span
      aria-disabled
      aria-label={label}
      className={cn(className, "pointer-events-none opacity-40")}
    >
      {children}
    </span>
  );
}
