import type { LucideIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

/** Shared empty state: what is missing and what to do about it. */
export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-24 text-center">
      <span className="flex size-11 items-center justify-center rounded-full bg-signal-soft text-signal">
        <Icon aria-hidden className="size-5" />
      </span>
      <p className="text-base font-semibold">{title}</p>
      {children && <div className="leading-relaxed text-muted-foreground">{children}</div>}
    </div>
  );
}

/** The command behind a state, for whoever runs the app: Léa reads the sentence above it. */
export function DevNote({ command }: { command: string }) {
  return (
    <p className="mt-3 text-[12px] text-muted-foreground/80">
      Note développeur : <code className="font-mono">{command}</code>
    </p>
  );
}

export function PageSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-8" aria-busy="true" aria-label="Chargement">
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-4 w-96" />
      <div className="mt-4 flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
