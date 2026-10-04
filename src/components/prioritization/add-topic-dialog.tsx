"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
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
import { formatNumber, formatPercent } from "@/lib/format";
import type { ManualTopic } from "@/lib/prioritization/requests";
import { createTopicAction } from "@/server/actions/prioritization";
import { FIELD, LABEL, usePrioritizationWrite } from "./use-write";

const EMPTY = {
  title: "",
  problem: "",
  comptes: "",
  mrr: "",
  impact: "1",
  confidence: "50",
  effort: "",
  estimate: false,
  reason: "",
};

const toNumber = (value: string) => Number(value.trim().replace(",", "."));

/**
 * « Ajouter un sujet » (SPEC §8.9, CL-25): a topic that does not come from the feedbacks —
 * technical debt, strategic bet, a request from management. The PO's values are checked by
 * lib/scoring on the server; Signal judges its alignment and can estimate its effort.
 */
export function AddTopicDialog({
  impactScale,
  confidenceLevels,
}: {
  impactScale: number[];
  confidenceLevels: number[];
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const { pending, error, warning, run, setError } = usePrioritizationWrite();
  const set = (patch: Partial<typeof EMPTY>) => setForm((f) => ({ ...f, ...patch }));

  const topic = (): ManualTopic => ({
    title: form.title.trim(),
    problem_statement: form.problem.trim(),
    reach_comptes: toNumber(form.comptes),
    reach_mrr: form.mrr.trim() === "" ? null : toNumber(form.mrr),
    impact: toNumber(form.impact),
    confidence: toNumber(form.confidence),
    effort_weeks: form.estimate || form.effort.trim() === "" ? null : toNumber(form.effort),
    reason: form.reason.trim(),
  });
  const ready =
    form.title.trim().length >= 3 &&
    form.problem.trim().length >= 10 &&
    form.comptes.trim() !== "" &&
    form.reason.trim() !== "" &&
    (form.estimate || form.effort.trim() !== "");

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (pending) return;
          setOpen(next);
          if (next) {
            setForm(EMPTY);
            setError(null);
          }
        }}
      >
        <DialogTrigger render={<Button />}>
          <Plus aria-hidden />
          Ajouter un sujet
        </DialogTrigger>
        <DialogContent className="gap-4 p-5 text-[15px] sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-base">Ajouter un sujet hors retours</DialogTitle>
            <DialogDescription>
              Dette technique, pari stratégique, demande de la direction : le sujet entre dans le
              même classement, avec le badge « manuel ». Signal juge son alignement et recommande un
              MoSCoW.
            </DialogDescription>
          </DialogHeader>
          <form
            id="add-topic"
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              run(
                () => createTopicAction(topic()),
                () => setOpen(false),
              );
            }}
          >
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Titre (le problème)</span>
              <Input
                value={form.title}
                onChange={(e) => set({ title: e.target.value })}
                maxLength={140}
                placeholder="Migrer l'authentification"
                className="h-9 text-sm"
                disabled={pending}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Problème</span>
              <Textarea
                value={form.problem}
                onChange={(e) => set({ problem: e.target.value })}
                maxLength={800}
                className="min-h-20 text-sm"
                disabled={pending}
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Reach (comptes concernés)</span>
                <input
                  inputMode="decimal"
                  value={form.comptes}
                  onChange={(e) => set({ comptes: e.target.value })}
                  className={FIELD}
                  disabled={pending}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>MRR concerné en € (facultatif)</span>
                <input
                  inputMode="decimal"
                  value={form.mrr}
                  onChange={(e) => set({ mrr: e.target.value })}
                  placeholder="non renseigné"
                  className={FIELD}
                  disabled={pending}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Impact</span>
                <select
                  value={form.impact}
                  onChange={(e) => set({ impact: e.target.value })}
                  className={FIELD}
                  disabled={pending}
                >
                  {impactScale.map((v) => (
                    <option key={v} value={String(v)}>
                      {formatNumber(v, 2)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Confidence</span>
                <select
                  value={form.confidence}
                  onChange={(e) => set({ confidence: e.target.value })}
                  className={FIELD}
                  disabled={pending}
                >
                  {confidenceLevels.map((v) => (
                    <option key={v} value={String(Math.round(v * 100))}>
                      {formatPercent(v)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <fieldset className="flex flex-col gap-1.5">
              <legend className={LABEL}>Effort</legend>
              <div className="flex items-center gap-3">
                <input
                  inputMode="decimal"
                  value={form.estimate ? "" : form.effort}
                  onChange={(e) => set({ effort: e.target.value })}
                  placeholder="semaines-personne"
                  className={`${FIELD} max-w-44`}
                  disabled={pending || form.estimate}
                  aria-label="Effort en semaines-personne"
                />
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.estimate}
                    onChange={(e) => set({ estimate: e.target.checked })}
                    disabled={pending}
                    className="size-4 accent-[var(--signal)]"
                  />
                  Estimer avec Signal
                </label>
              </div>
            </fieldset>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Raison (obligatoire, journalisée avec chaque valeur)</span>
              <Input
                value={form.reason}
                onChange={(e) => set({ reason: e.target.value })}
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
            {pending && (
              <span className="mr-auto self-center text-muted-foreground">
                Signal juge l&apos;alignement{form.estimate ? " et estime l'effort" : ""}…
              </span>
            )}
            <Button type="submit" form="add-topic" disabled={pending || !ready}>
              {pending && <Loader2 aria-hidden className="animate-spin" />}
              Ajouter au classement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {warning && (
        <p role="status" className="text-amber-700 dark:text-amber-300">
          {warning}
        </p>
      )}
    </>
  );
}
