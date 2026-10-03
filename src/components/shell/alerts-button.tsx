"use client";

import { Bell } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { buttonVariants } from "@/components/ui/button";
import { EvidenceChip, InsightChip } from "@/components/signal/chips";
import { Pill } from "@/components/signal/badges";
import { formatRelative } from "@/lib/format";
import { ALERT_KIND_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { OpenAlert } from "@/server/queries/shell";

const MAX_EVIDENCE = 3;

const DOSSIER_LABELS = {
  en_cours: "Dossier en cours",
  pret: "Dossier prêt",
  echec: "Dossier indisponible",
} as const;

/** Badge of open alerts (SPEC §10.10) that opens their list. */
export function AlertsButton({ alerts, now }: { alerts: OpenAlert[]; now: string }) {
  const count = alerts.length;
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`${count} alerte${count > 1 ? "s" : ""} ouverte${count > 1 ? "s" : ""}`}
        className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
      >
        <Bell aria-hidden className={count > 0 ? "text-amber-600" : "text-muted-foreground"} />
        Alertes
        <span
          className={cn(
            "min-w-5 rounded-full px-1.5 text-center text-[13px] leading-5 font-semibold tabular-nums",
            count > 0 ? "bg-amber-500 text-white" : "bg-muted text-muted-foreground",
          )}
        >
          {count}
        </span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[30rem] gap-0 p-0 text-sm">
        <p className="border-b px-4 py-3 font-medium">Alertes ouvertes</p>
        {count === 0 ? (
          <p className="px-4 py-6 text-center text-muted-foreground">
            Aucune alerte ouverte. Le reste est dans le digest.
          </p>
        ) : (
          <ul className="max-h-[28rem] divide-y overflow-y-auto">
            {alerts.map((alert) => (
              <li key={alert.id} className="flex flex-col gap-2 px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{ALERT_KIND_LABELS[alert.kind]}</span>
                  {alert.status === "nouvelle" && (
                    <Pill className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
                      Nouvelle
                    </Pill>
                  )}
                  <span className="ml-auto text-muted-foreground">
                    {formatRelative(alert.created_at, now)}
                  </span>
                </div>
                {alert.insight_id && (
                  <InsightChip id={alert.insight_id} title={alert.insight_title} />
                )}
                <div className="flex flex-wrap items-center gap-1">
                  {alert.feedback_ids.slice(0, MAX_EVIDENCE).map((id) => (
                    <EvidenceChip key={id} id={id} />
                  ))}
                  {alert.feedback_ids.length > MAX_EVIDENCE && (
                    <span className="text-muted-foreground">
                      +{alert.feedback_ids.length - MAX_EVIDENCE}
                    </span>
                  )}
                  <span className="ml-auto text-muted-foreground">
                    {alert.dossier_status
                      ? DOSSIER_LABELS[alert.dossier_status]
                      : "Pas encore de dossier"}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
