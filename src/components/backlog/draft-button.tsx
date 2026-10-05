"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { draftBacklogAction } from "@/server/actions/backlog";
import type { DraftResult } from "@/services/backlog";

type Confirmation = Extract<DraftResult, { needs_confirmation: true }>;

/**
 * « Rédiger le backlog » (SPEC §12.4, §12.6): the same service as the chat. Existing drafts are
 * replaced only once the PO confirms (CL-33); the Backlog screen opens on the insight afterwards.
 */
export function DraftBacklogButton({
  insightId,
  label = "Rédiger le backlog",
  variant = "outline",
}: {
  insightId: string;
  label?: string;
  variant?: "outline" | "default";
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const draft = (confirm: boolean) =>
    startTransition(async () => {
      setError(null);
      const response = await draftBacklogAction(insightId, confirm);
      if (!response.ok) {
        setConfirmation(null);
        setError(response.message);
        return;
      }
      if (response.result.needs_confirmation) {
        setConfirmation(response.result);
        return;
      }
      setConfirmation(null);
      router.push(`/backlog?insight=${insightId}`);
    });

  return (
    <div className="flex flex-col gap-1">
      <Button variant={variant} onClick={() => draft(false)} disabled={pending}>
        {pending ? <Loader2 aria-hidden className="animate-spin" /> : <FileText aria-hidden />}
        {pending ? "Rédaction en cours (≈ 30 s)…" : label}
      </Button>
      {error && (
        <p role="alert" className="max-w-md text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={confirmation !== null}
        onOpenChange={(open) => !open && !pending && setConfirmation(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remplacer les brouillons de {insightId} ?</DialogTitle>
            <DialogDescription>
              Les brouillons seront remplacés par une nouvelle rédaction. Les éléments validés ou
              envoyés dans Notion sont conservés.
            </DialogDescription>
          </DialogHeader>
          {confirmation && (
            <div className="flex flex-col gap-2 text-sm">
              <p>
                Remplacés :{" "}
                <span className="font-mono">{confirmation.drafts.map((d) => d.id).join(", ")}</span>
              </p>
              {confirmation.kept.length > 0 && (
                <p>
                  Conservés :{" "}
                  <span className="font-mono">{confirmation.kept.map((k) => k.id).join(", ")}</span>
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmation(null)} disabled={pending}>
              Annuler
            </Button>
            <Button onClick={() => draft(true)} disabled={pending}>
              {pending && <Loader2 aria-hidden className="animate-spin" />}
              Remplacer les brouillons
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
