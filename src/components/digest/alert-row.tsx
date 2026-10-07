"use client";

import { useState } from "react";
import { ChevronDown, Loader2, MessageSquare, Play, TriangleAlert, X } from "lucide-react";
import {
  DOSSIER_FAILED,
  DOSSIER_LABELS,
  DossierBody,
  useAlertActions,
} from "@/components/alerts/alert-card";
import { EvidenceChip, InsightChip } from "@/components/signal/chips";
import { Button } from "@/components/ui/button";
import { evidenceNotInText } from "@/lib/digest/content";
import { ALERT_KIND_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { OpenAlert } from "@/server/queries/shell";
import { InboxMeta, InboxRow, type Confidence } from "./inbox";

const MAX_EVIDENCE = 4;

/**
 * An open alert in the digest's « À traiter » list (SPEC §12.2): folded to its title, the
 * recommendation in one sentence, the evidence and the actions; the dossier unfolds below.
 */
export function AlertRow({ alert }: { alert: OpenAlert }) {
  const [open, setOpen] = useState(false);
  const actions = useAlertActions(alert);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) actions.markSeen();
  };
  const confidence = (["haute", "moyenne", "basse"] as const).find((c) => c === alert.confiance);
  const evidence = evidenceNotInText(alert.feedback_ids, [
    alert.titre ?? "",
    alert.recommandation ?? "",
  ]);

  return (
    <InboxRow
      tone="alert"
      marker={<TriangleAlert aria-hidden className="size-4" />}
      title={alert.titre ?? ALERT_KIND_LABELS[alert.kind]}
      summary={
        alert.recommandation ??
        (alert.dossier_status ? DOSSIER_LABELS[alert.dossier_status] : "Pas encore de dossier")
      }
      meta={
        <InboxMeta confidence={confidence as Confidence | undefined}>
          <span className="mr-1 text-[13px] font-medium text-muted-foreground">
            {ALERT_KIND_LABELS[alert.kind]}
          </span>
          {alert.insight_id && <InsightChip id={alert.insight_id} />}
          {evidence.slice(0, MAX_EVIDENCE).map((id) => (
            <EvidenceChip key={id} id={id} />
          ))}
          {evidence.length > MAX_EVIDENCE && (
            <span className="text-muted-foreground">+{evidence.length - MAX_EVIDENCE}</span>
          )}
          {alert.dossier_status === "en_cours" && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Loader2 aria-hidden className="size-3.5 animate-spin" />
              Signal enquête
            </span>
          )}
        </InboxMeta>
      }
      actions={
        <>
          {actions.act && (
            <Button size="sm" disabled={actions.busy} onClick={actions.act.run}>
              <Play aria-hidden />
              {actions.act.label}
            </Button>
          )}
          {actions.ready ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={toggle}
              aria-expanded={open}
              aria-controls={`dossier-${alert.id}`}
            >
              Dossier
              <ChevronDown
                aria-hidden
                className={cn(
                  "transition-transform motion-reduce:transition-none",
                  open && "rotate-180",
                )}
              />
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={actions.pending}
                onClick={actions.discuss}
              >
                <MessageSquare aria-hidden />
                En parler à Signal
              </Button>
              <Button size="sm" variant="ghost" disabled={actions.pending} onClick={actions.ignore}>
                <X aria-hidden />
                Ignorer
              </Button>
            </>
          )}
        </>
      }
    >
      {alert.dossier_status === "echec" && (
        <p className="text-muted-foreground">{DOSSIER_FAILED}</p>
      )}
      {actions.ready && open && (
        <div
          id={`dossier-${alert.id}`}
          className="flex flex-col gap-2 rounded-md border border-amber-200 bg-background px-4 py-3 dark:border-amber-900"
        >
          <DossierBody alert={alert} />
          <div className="flex flex-wrap justify-end gap-2 border-t pt-2.5">
            <Button
              size="sm"
              variant="outline"
              disabled={actions.pending}
              onClick={actions.discuss}
            >
              <MessageSquare aria-hidden />
              En parler à Signal
            </Button>
            <Button size="sm" variant="ghost" disabled={actions.pending} onClick={actions.ignore}>
              <X aria-hidden />
              Ignorer
            </Button>
          </div>
        </div>
      )}
      {actions.error && <p className="text-red-700 dark:text-red-300">{actions.error}</p>}
    </InboxRow>
  );
}
