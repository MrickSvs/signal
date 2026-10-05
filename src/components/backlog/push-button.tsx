"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, RotateCw, Send } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { notionPageUrl } from "@/lib/labels";
import { pushBacklogItemAction } from "@/server/actions/backlog";
import type { BacklogViewItem } from "@/server/queries/backlog";

// « Valider et envoyer » of the Backlog screen (SPEC §11.2, §12.6): the dialog is Léa's approval,
// the same service as push_to_notion in the chat. A failure keeps the item « valide » with its
// error and a « Réessayer »; a sent item opens in Notion instead of being edited.

export function NotionLink({ pageId }: { pageId: string }) {
  return (
    <a
      href={notionPageUrl(pageId)}
      target="_blank"
      rel="noreferrer"
      className={buttonVariants({ size: "sm", variant: "outline", className: "w-fit" })}
    >
      <ExternalLink aria-hidden />
      Ouvrir dans Notion
    </a>
  );
}

export function PushButton({ item }: { item: BacklogViewItem }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const draft = item.status === "brouillon";
  const retry = item.status === "valide" && item.push_error !== null;

  const send = () =>
    startTransition(async () => {
      setError(null);
      const response = await pushBacklogItemAction(item.id);
      if (!response.ok) return setError(response.message);
      if (!response.result.ok) setError(response.result.error);
      else setOpen(false);
      router.refresh();
    });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <DialogTrigger render={<Button size="sm" variant={retry ? "outline" : "default"} />}>
        {retry ? <RotateCw aria-hidden /> : <Send aria-hidden />}
        {retry ? "Réessayer" : draft ? "Valider et envoyer" : "Envoyer dans Notion"}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {draft ? "Valider et envoyer" : "Envoyer"} {item.id} dans Notion
          </DialogTitle>
          <DialogDescription>
            {draft ? "Le brouillon passe en « validé », puis " : ""}
            {draft ? "la" : "La"} page est créée dans le kanban de l&apos;équipe, colonne « Prêt ».
            Ensuite, l&apos;élément se modifie dans Notion, plus dans Signal. Ta décision est
            journalisée.
          </DialogDescription>
        </DialogHeader>
        <p className="font-medium">{item.title}</p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button onClick={send} disabled={pending}>
            {pending && <Loader2 aria-hidden className="animate-spin" />}
            {pending ? "Envoi…" : draft ? "Valider et envoyer" : "Envoyer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
