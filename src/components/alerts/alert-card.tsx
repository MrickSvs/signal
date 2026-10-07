"use client";

import { useState, useTransition } from "react";
import { ExternalLink, Loader2, MessageSquare, Play, X } from "lucide-react";
import { useChat } from "@/components/chat/chat-provider";
import { DigestMarkdown } from "@/components/digest/id-text";
import { EvidenceChip, InsightChip } from "@/components/signal/chips";
import { ModelBadge, Pill } from "@/components/signal/badges";
import { Button } from "@/components/ui/button";
import { alertActionMessage, DOSSIER_ACTION_LABELS } from "@/lib/alerts";
import { formatCost, formatRelative } from "@/lib/format";
import { ALERT_KIND_LABELS } from "@/lib/labels";
import { MODELS } from "@/lib/llm/models";
import { cn } from "@/lib/utils";
import { answerAlertAction } from "@/server/actions/alerts";
import type { OpenAlert } from "@/server/queries/shell";

const MAX_EVIDENCE = 3;

export const DOSSIER_LABELS = {
  en_cours: "Signal enquête…",
  pret: "Dossier prêt",
  echec: "Dossier indisponible",
} as const;

/**
 * What Léa can do with an open alert, shared by the card (header, chat) and the digest row:
 * « Faire l'action proposée » goes through the chat so a decision ends on an approval card,
 * « Ignorer » is journaled, « En parler à Signal » brings the dossier into the briefing.
 */
export function useAlertActions(alert: OpenAlert, onDone?: () => void) {
  const chat = useChat();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const action = alert.action;
  const message = alertActionMessage(alert);
  const ready = Boolean(alert.dossier_status === "pret" && alert.dossier_markdown);

  const answer = (input: Parameters<typeof answerAlertAction>[0]["answer"], then?: () => void) =>
    startTransition(async () => {
      setError(null);
      const result = await answerAlertAction({ alertId: alert.id, answer: input });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      then?.();
    });

  return {
    ready,
    error,
    pending,
    busy: pending || chat.busy,
    /** The proposed action, when the dossier has one the chat can carry out. */
    act:
      ready && message && action
        ? {
            label: `${DOSSIER_ACTION_LABELS[action.type]}${action.cible ? ` ${action.cible}` : ""}`,
            run: () =>
              answer({ kind: "act", action }, () => {
                chat.sendAboutAlert(message, alert.id);
                onDone?.();
              }),
          }
        : null,
    markSeen: () => {
      if (alert.status === "nouvelle") answer({ kind: "seen" });
    },
    discuss: () => {
      if (alert.status === "nouvelle") answer({ kind: "seen" });
      chat.discussAlert(alert);
      onDone?.();
    },
    ignore: () => answer({ kind: "ignore" }, onDone),
  };
}

/** The dossier body (title stripped: the caller shows it), model, cost and trace link. */
export function DossierBody({ alert }: { alert: OpenAlert }) {
  return (
    <>
      <DigestMarkdown markdown={alert.dossier_markdown!.replace(/^\*\*[^\n]*\*\*\n+/, "")} />
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
        <ModelBadge model={MODELS.agent} />
        {alert.cost_eur !== null && <span>{formatCost(Number(alert.cost_eur))}</span>}
        {alert.langfuse_url && (
          <a
            href={alert.langfuse_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
          >
            Trace de l&apos;enquête <ExternalLink aria-hidden className="size-3" />
          </a>
        )}
      </div>
    </>
  );
}

/** An alert and its investigation dossier (SPEC §10.10), in the header list and in the chat. */
export function AlertCard({
  alert,
  now,
  defaultOpen = false,
  onDone,
}: {
  alert: OpenAlert;
  now: string;
  defaultOpen?: boolean;
  /** Called once Léa handled or ignored it (the header list closes its popover). */
  onDone?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const actions = useAlertActions(alert, onDone);
  const { ready } = actions;

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) actions.markSeen();
  };

  return (
    <div className="flex flex-col gap-2">
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
      {alert.insight_id && <InsightChip id={alert.insight_id} title={alert.insight_title} />}
      <div className="flex flex-wrap items-center gap-1">
        {alert.feedback_ids.slice(0, MAX_EVIDENCE).map((id) => (
          <EvidenceChip key={id} id={id} />
        ))}
        {alert.feedback_ids.length > MAX_EVIDENCE && (
          <span className="text-muted-foreground">+{alert.feedback_ids.length - MAX_EVIDENCE}</span>
        )}
        <span
          className={cn(
            "ml-auto flex items-center gap-1",
            alert.dossier_status === "echec"
              ? "text-red-700 dark:text-red-300"
              : "text-muted-foreground",
          )}
        >
          {alert.dossier_status === "en_cours" && (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          )}
          {alert.dossier_status ? DOSSIER_LABELS[alert.dossier_status] : "Pas encore de dossier"}
        </span>
      </div>

      {ready && (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="rounded-md text-left font-medium underline-offset-2 hover:underline"
        >
          {alert.titre ?? "Dossier d'enquête"}
          <span className="ml-1 font-normal text-muted-foreground">
            {open ? "· masquer" : "· lire le dossier"}
          </span>
        </button>
      )}
      {ready && open && (
        <div className="flex flex-col gap-2 rounded-md border bg-background px-3 py-2.5">
          <DossierBody alert={alert} />
        </div>
      )}
      {alert.dossier_status === "echec" && (
        <p className="text-muted-foreground">{DOSSIER_FAILED}</p>
      )}

      <AlertActions actions={actions} />
    </div>
  );
}

export const DOSSIER_FAILED =
  "L'enquête n'a pas abouti (échec ou budget dépassé). Les preuves restent affichées ; tu peux en parler à Signal.";

/** Proposed action, « En parler à Signal », « Ignorer », and the error of the last answer. */
export function AlertActions({ actions }: { actions: ReturnType<typeof useAlertActions> }) {
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {actions.act && (
          <Button size="sm" disabled={actions.busy} onClick={actions.act.run}>
            <Play aria-hidden />
            {actions.act.label}
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={actions.pending} onClick={actions.discuss}>
          <MessageSquare aria-hidden />
          En parler à Signal
        </Button>
        <Button size="sm" variant="ghost" disabled={actions.pending} onClick={actions.ignore}>
          <X aria-hidden />
          Ignorer
        </Button>
      </div>
      {actions.error && <p className="text-red-700 dark:text-red-300">{actions.error}</p>}
    </>
  );
}
