"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, GitMerge, Loader2, PenLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PILL_TONES } from "@/components/signal/tones";
import { PRODUCT_AREA_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { reviewInsightAction } from "@/server/actions/insights";
import type { MergeTarget } from "@/server/queries/insights";
import {
  STATEMENT_MAX,
  TITLE_MAX,
  unsentBacklogNote,
  type InsightReview,
  type UnsentBacklog,
} from "@/lib/insights/review";

export type ReviewableInsight = { id: string; title: string; problem_statement: string };

const FIELD = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm";
const LABEL = "text-[13px] font-medium text-muted-foreground";

/** Sends one review decision; refreshes the page on success, returns the error message otherwise. */
export function useReview() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (review: InsightReview, onDone?: () => void) =>
    startTransition(async () => {
      setError(null);
      const response = await reviewInsightAction(review);
      if (!response.ok) {
        setError(response.message);
        return;
      }
      onDone?.();
      router.refresh();
    });
  return { pending, error, run, setError };
}

type Kind = "reformuler" | "fusionner" | "rejeter";

const TRIGGERS: Record<Kind, { label: string; icon: typeof Check }> = {
  reformuler: { label: "Reformuler", icon: PenLine },
  fusionner: { label: "Fusionner", icon: GitMerge },
  rejeter: { label: "Rejeter", icon: X },
};

/** Accepter, Reformuler, Fusionner, Rejeter (SPEC §8.10): each choice is logged in decisions. */
export function ReviewActions({
  insight,
  targets,
  size = "sm",
  canAccept = true,
  unsent,
}: {
  insight: ReviewableInsight;
  targets: MergeTarget[];
  size?: "sm" | "default";
  /** False for an insight already active: rewording, merging and rejecting stay possible. */
  canAccept?: boolean;
  /** Its backlog items not sent yet: the reject and merge confirmations name them. */
  unsent?: UnsentBacklog;
}) {
  const accept = useReview();
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {canAccept && (
        <Button
          size={size}
          onClick={() => accept.run({ action: "accepter", insight_ids: [insight.id] })}
          disabled={accept.pending}
        >
          {accept.pending ? (
            <Loader2 aria-hidden className="animate-spin" />
          ) : (
            <Check aria-hidden />
          )}
          Accepter
        </Button>
      )}
      <ReviewDialog kind="reformuler" insight={insight} targets={targets} size={size} />
      <ReviewDialog
        kind="fusionner"
        insight={insight}
        targets={targets}
        size={size}
        unsent={unsent}
      />
      <ReviewDialog
        kind="rejeter"
        insight={insight}
        targets={targets}
        size={size}
        unsent={unsent}
      />
      {accept.error && (
        <p role="alert" className="w-full text-destructive">
          {accept.error}
        </p>
      )}
    </div>
  );
}

function ReviewDialog({
  kind,
  insight,
  targets,
  size,
  unsent,
}: {
  kind: Kind;
  insight: ReviewableInsight;
  targets: MergeTarget[];
  size: "sm" | "default";
  unsent?: UnsentBacklog;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(insight.title);
  const [statement, setStatement] = useState(insight.problem_statement);
  const [into, setInto] = useState("");
  const [reason, setReason] = useState("");
  const { pending, error, run, setError } = useReview();
  const { label, icon: Icon } = TRIGGERS[kind];
  const others = targets.filter((t) => t.id !== insight.id);
  const backlogNote = kind === "reformuler" ? null : unsentBacklogNote(insight.id, unsent);

  const review = (): InsightReview => {
    const why = reason.trim() || undefined;
    if (kind === "reformuler") {
      return {
        action: "reformuler",
        insight_id: insight.id,
        title: title.trim(),
        problem_statement: statement.trim(),
        reason: why,
      };
    }
    if (kind === "fusionner")
      return { action: "fusionner", insight_id: insight.id, into, reason: why };
    return { action: "rejeter", insight_id: insight.id, reason: why };
  };
  const ready =
    kind === "reformuler"
      ? title.trim().length >= 3 && statement.trim().length >= 10
      : kind === "fusionner"
        ? into !== ""
        : true;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) {
          setTitle(insight.title);
          setStatement(insight.problem_statement);
          setInto("");
          setReason("");
          setError(null);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button
            size={size}
            variant={kind === "rejeter" ? "ghost" : "outline"}
            className={cn(kind === "rejeter" && "text-muted-foreground hover:text-destructive")}
          />
        }
      >
        <Icon aria-hidden />
        {label}
      </DialogTrigger>
      <DialogContent className="gap-4 p-5 text-[15px] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">
            {label} {insight.id}
          </DialogTitle>
          <DialogDescription>
            {kind === "reformuler" &&
              "Ta formulation remplace celle de Signal et ne sera plus réécrite par les runs suivants. L'insight devient actif."}
            {kind === "fusionner" &&
              `Les retours de ${insight.id} rejoignent l'insight choisi ; ${insight.id} passe « fusionné » et le reste aux runs suivants.`}
            {kind === "rejeter" &&
              `${insight.id} sort du classement. Il reste consultable et restera rejeté s'il se reforme.`}
          </DialogDescription>
        </DialogHeader>
        {backlogNote && (
          <p role="note" className={cn("rounded-lg border px-3 py-2 text-sm", PILL_TONES.risk)}>
            {backlogNote}
          </p>
        )}
        <form
          id={`review-${kind}-${insight.id}`}
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            run(review(), () => setOpen(false));
          }}
        >
          {kind === "reformuler" && (
            <>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Titre (le problème, pas la solution)</span>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={TITLE_MAX}
                  required
                  className="h-9 text-sm"
                  disabled={pending}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Énoncé du problème</span>
                <Textarea
                  value={statement}
                  onChange={(event) => setStatement(event.target.value)}
                  maxLength={STATEMENT_MAX}
                  required
                  className="min-h-28 text-sm"
                  disabled={pending}
                />
              </label>
            </>
          )}
          {kind === "fusionner" && (
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Fusionner dans</span>
              <select
                value={into}
                onChange={(event) => setInto(event.target.value)}
                className={FIELD}
                required
                disabled={pending}
              >
                <option value="">Choisis un insight…</option>
                {others.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id} · {t.title}
                    {t.product_area ? ` (${PRODUCT_AREA_LABELS[t.product_area]})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Raison (facultative, journalisée)</span>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              className="h-9 text-sm"
              disabled={pending}
            />
          </label>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </form>
        <DialogFooter>
          <Button
            type="submit"
            form={`review-${kind}-${insight.id}`}
            variant={kind === "rejeter" ? "destructive" : "default"}
            disabled={pending || !ready}
          >
            {pending && <Loader2 aria-hidden className="animate-spin" />}
            {kind === "reformuler" ? "Enregistrer" : label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
