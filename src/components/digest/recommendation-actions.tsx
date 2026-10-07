"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { RecommendationOutcome } from "@/lib/digest/handled";
import { answerRecommendationAction } from "@/server/actions/digest";
import type { RecommendationAnswered } from "@/server/queries/digest";

const OUTCOME_LABELS: Record<RecommendationOutcome, string> = {
  fait: "Fait",
  ecartee: "Écartée",
};

/**
 * « Fait » / « Écarter » on a recommendation (ADR-036): one decision in the journal, and the next
 * digests do not propose it again without a new fact. « Écarter » asks for an optional reason.
 */
export function RecommendationActions({
  digestId,
  index,
  answered,
}: {
  digestId: string;
  index: number;
  answered: RecommendationAnswered | undefined;
}) {
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (answered) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground">
        {answered.outcome === "fait" ? (
          <Check aria-hidden className="size-3.5" />
        ) : (
          <X aria-hidden className="size-3.5" />
        )}
        {OUTCOME_LABELS[answered.outcome]} ·{" "}
        <span className="font-mono">{answered.decision_id}</span>
      </span>
    );
  }

  const answer = (outcome: RecommendationOutcome) =>
    startTransition(async () => {
      setError(null);
      const result = await answerRecommendationAction({
        digestId,
        index,
        outcome,
        reason: outcome === "ecartee" ? reason : null,
      });
      if (!result.ok) setError(result.message);
    });

  return (
    <div className="flex flex-col items-end gap-1.5">
      {rejecting ? (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            answer("ecartee");
          }}
        >
          <Input
            autoFocus
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            placeholder="Raison (facultatif)"
            aria-label="Raison pour écarter la recommandation"
            className="h-8 w-48"
          />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : <X aria-hidden />}
            Écarter
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setRejecting(false)}
          >
            Annuler
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => answer("fait")}>
            {pending ? <Loader2 aria-hidden className="animate-spin" /> : <Check aria-hidden />}
            Fait
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setRejecting(true)}>
            <X aria-hidden />
            Écarter
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
