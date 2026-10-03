import { connection } from "next/server";
import { getDb } from "@/lib/db/client";
import { getDemoNow } from "@/lib/demo-now";
import { formatDateTime, formatRelative } from "@/lib/format";
import { RUN_KIND_LABELS, RUN_STATUS_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { getLastPipelineRun, listOpenAlerts } from "@/server/queries/shell";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertsButton } from "./alerts-button";

const STATUS_DOTS = {
  en_cours: "bg-sky-500 animate-pulse",
  termine: "bg-emerald-500",
  echec: "bg-red-500",
} as const;

/** Last run status and date, and the open alerts badge (SPEC §12.1). */
export async function HeaderStatus() {
  await connection();
  const db = getDb();
  const [run, alerts] = await Promise.allSettled([getLastPipelineRun(db), listOpenAlerts(db)]);
  const now = getDemoNow();

  return (
    <>
      {run.status === "rejected" ? (
        <span className="text-muted-foreground">Statut du pipeline indisponible</span>
      ) : run.value === null ? (
        <span className="text-muted-foreground">Aucun run pour l&apos;instant</span>
      ) : (
        <span
          className="flex items-center gap-2 text-muted-foreground"
          title={`Démarré le ${formatDateTime(run.value.started_at)} (heure de Paris)`}
        >
          <span aria-hidden className={cn("size-2 rounded-full", STATUS_DOTS[run.value.status])} />
          {RUN_KIND_LABELS[run.value.kind]} {RUN_STATUS_LABELS[run.value.status]} ·{" "}
          {formatRelative(run.value.ended_at ?? run.value.started_at, now)}
        </span>
      )}
      {alerts.status === "rejected" ? (
        <span className="text-muted-foreground">Alertes indisponibles</span>
      ) : (
        <AlertsButton alerts={alerts.value} now={now.toISOString()} />
      )}
    </>
  );
}

export function HeaderStatusSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-8 w-28" />
    </>
  );
}
