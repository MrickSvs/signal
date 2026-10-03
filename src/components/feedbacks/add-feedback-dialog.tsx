"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { EvidenceChip, InsightChip } from "@/components/signal/chips";
import { Pill } from "@/components/signal/badges";
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
import { Textarea } from "@/components/ui/textarea";
import { Constants, type Database } from "@/lib/db/types";
import { OFFLINE_MESSAGE, ingestErrorMessage } from "@/lib/feedbacks/ingest";
import { formatCost, formatNumber } from "@/lib/format";
import { CHANNEL_LABELS, CHANNEL_SOURCE_TYPES, ITEM_TYPE_LABELS, PLAN_LABELS } from "@/lib/labels";
import type { IncrementalResult, ItemOutcome } from "@/pipeline/incremental";
import type { CustomerOption } from "@/server/queries/feedbacks";

type Channel = Database["public"]["Enums"]["feedback_channel"];

type State =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "done"; result: IncrementalResult }
  | { kind: "error"; message: string };

const FIELD = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm";

/**
 * « Ajouter un retour » (SPEC §12.3): channel, optional account and text → the incremental
 * pipeline → what Signal did with it, how long it took and what it cost.
 */
export function AddFeedbackDialog({ customers }: { customers: CustomerOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<Channel>("ticket_support");
  const [customerId, setCustomerId] = useState("");
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const running = state.kind === "running";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState({ kind: "running" });
    try {
      const response = await fetch("/api/pipeline/incremental", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          feedbacks: [
            {
              channel,
              source_type: CHANNEL_SOURCE_TYPES[channel],
              customer_id: customerId || null,
              raw_text: text,
            },
          ],
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setState({ kind: "error", message: ingestErrorMessage(response.status, body) });
        return;
      }
      setState({ kind: "done", result: body as IncrementalResult });
      setText("");
      router.refresh();
    } catch {
      setState({ kind: "error", message: OFFLINE_MESSAGE });
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (running) return;
        setOpen(next);
        if (!next) setState({ kind: "idle" });
      }}
    >
      <DialogTrigger render={<Button />}>
        <Plus aria-hidden />
        Ajouter un retour
      </DialogTrigger>
      <DialogContent className="gap-4 p-5 text-[15px] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-base">Ajouter un retour</DialogTitle>
          <DialogDescription>
            Signal l&apos;analyse, le rattache au sujet le plus proche ou le met en file « à
            surveiller ». Quelques secondes.
          </DialogDescription>
        </DialogHeader>
        {state.kind === "done" ? (
          <IncrementalOutcome result={state.result} />
        ) : (
          <form id="add-feedback" onSubmit={submit} className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[13px] font-medium text-muted-foreground">Canal</span>
                <select
                  value={channel}
                  onChange={(event) => setChannel(event.target.value as Channel)}
                  className={FIELD}
                  disabled={running}
                >
                  {Constants.public.Enums.feedback_channel.map((c) => (
                    <option key={c} value={c}>
                      {CHANNEL_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[13px] font-medium text-muted-foreground">
                  Compte (facultatif)
                </span>
                <select
                  value={customerId}
                  onChange={(event) => setCustomerId(event.target.value)}
                  className={FIELD}
                  disabled={running}
                >
                  <option value="">Compte non identifié</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ·{" "}
                      {c.status === "prospect" || !c.plan ? "Prospect" : PLAN_LABELS[c.plan]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-medium text-muted-foreground">Texte du retour</span>
              <Textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Colle ici l'e-mail, le ticket ou la note…"
                className="min-h-40 text-sm"
                required
                maxLength={50_000}
                disabled={running}
              />
            </label>
            {state.kind === "error" && (
              <p role="alert" className="text-destructive">
                {state.message}
              </p>
            )}
          </form>
        )}
        <DialogFooter>
          {state.kind === "done" ? (
            <>
              <Button variant="outline" onClick={() => setState({ kind: "idle" })}>
                Ajouter un autre retour
              </Button>
              <Button onClick={() => setOpen(false)}>Fermer</Button>
            </>
          ) : (
            <Button type="submit" form="add-feedback" disabled={running || !text.trim()}>
              {running && <Loader2 aria-hidden className="animate-spin" />}
              {running ? "Analyse en cours…" : "Analyser"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItemLine({ item }: { item: ItemOutcome }) {
  return (
    <li className="flex flex-wrap items-center gap-1.5">
      <span className="font-mono text-muted-foreground">{item.id}</span>
      <Pill className="border-border bg-muted text-foreground">{ITEM_TYPE_LABELS[item.type]}</Pill>
      {item.outcome === "rattache" && item.insight_id ? (
        <>
          <span>rattaché à</span>
          <InsightChip id={item.insight_id} title={item.insight_title} />
          {item.similarity !== null && (
            <span className="text-muted-foreground">
              (similarité {formatNumber(item.similarity, 2)})
            </span>
          )}
        </>
      ) : item.outcome === "nouvel_insight" && item.insight_id ? (
        <>
          <span>forme un nouveau sujet à valider :</span>
          <InsightChip id={item.insight_id} title={item.insight_title} />
        </>
      ) : item.outcome === "surveille" ? (
        <span>sujet à surveiller : aucun insight assez proche pour l&apos;instant</span>
      ) : (
        <span className="text-muted-foreground">non regroupé (éloge, question ou autre)</span>
      )}
    </li>
  );
}

function IncrementalOutcome({ result }: { result: IncrementalResult }) {
  const alerts = result.alerts.created.length;
  return (
    <div role="status" className="flex flex-col gap-3">
      {result.feedbacks.map((feedback) => (
        <div key={feedback.id} className="flex flex-col gap-2 rounded-lg border px-4 py-3">
          <div className="flex items-center gap-2">
            <EvidenceChip id={feedback.id} />
            {feedback.status === "failed" && (
              <Pill className="border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
                Échec d&apos;analyse
              </Pill>
            )}
          </div>
          {feedback.status === "failed" ? (
            <p className="leading-relaxed text-muted-foreground">
              Le retour est enregistré mais son analyse a échoué après les nouvelles tentatives. Il
              sera repris au prochain run.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {feedback.items.map((item) => (
                <ItemLine key={item.id} item={item} />
              ))}
            </ul>
          )}
        </div>
      ))}
      {alerts > 0 && (
        <p className="font-medium">
          {alerts > 1 ? `${alerts} alertes créées` : "Une alerte créée"} : voir le badge des alertes
          en haut de page.
        </p>
      )}
      <p className="text-muted-foreground">
        Traité en {formatNumber(result.durationMs / 1000)} s · {formatCost(result.costEur)}
        {result.rescored.length > 0 && ` · ${result.rescored.join(", ")} re-scoré(s)`}
      </p>
    </div>
  );
}
