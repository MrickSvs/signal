"use client";

import { useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { Markdown } from "@/components/context/markdown";
import { BacklogKindBadge } from "@/components/signal/badges";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Annotation, CalibrationItem } from "@/lib/judge/calibration";
import type { JudgeKind, Verdict } from "@/lib/judge/judge";
import { cn } from "@/lib/utils";

type Grid = { text: string; criteria: string[] };

const FIELD_LABELS: Record<string, string> = {
  title: "Titre",
  value: "Afin de",
  persona: "En tant que",
  want: "Je veux",
  business_rules: "Règles de gestion",
  acceptance_criteria: "Critères d'acceptation",
  success_kpi: "KPI de succès",
  expected_behavior: "Comportement attendu",
  actual_behavior: "Comportement constaté",
  repro_steps: "Étapes de reproduction",
  severity: "Sévérité",
  objective: "Objectif",
  definition_of_done: "Définition de terminé",
  risks: "Risques",
  evidence: "Preuves",
  estimation: "Estimation",
  dependances: "Dépendances",
};

type Scenario = { name: string; edge_case: boolean; steps: { keyword: string; text: string }[] };

function FieldValue({ name, value }: { name: string; value: unknown }) {
  if (name === "acceptance_criteria" && Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">aucun</span>;
    return (
      <div className="space-y-2">
        {(value as Scenario[]).map((s, i) => (
          <div key={i} className="rounded-md border p-2 text-sm">
            <p className="font-medium">
              Scénario : {s.name}
              {s.edge_case && (
                <span className="ml-2 text-xs text-muted-foreground">(cas limite)</span>
              )}
            </p>
            {s.steps.map((step, j) => (
              <p key={j} className="pl-3">
                <span className="font-medium">{step.keyword}</span> {step.text}
              </p>
            ))}
          </div>
        ))}
      </div>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">aucun</span>;
    return (
      <ul className="list-disc space-y-0.5 pl-5">
        {value.map((v, i) => (
          <li key={i}>{typeof v === "string" ? v : JSON.stringify(v)}</li>
        ))}
      </ul>
    );
  }
  if (name === "estimation" && value && typeof value === "object") {
    const e = value as { points?: number | null; composants?: string[]; analogues?: string[] };
    return (
      <span>
        {e.points ?? "?"} points · composants {e.composants?.join(", ") || "—"} · analogues{" "}
        {e.analogues?.join(", ") || "—"}
      </span>
    );
  }
  if (value === null || value === undefined || value === "")
    return <span className="text-muted-foreground">vide</span>;
  return <span>{typeof value === "string" ? value : JSON.stringify(value)}</span>;
}

function ItemView({ item }: { item: CalibrationItem }) {
  const fields = Object.entries(item.content).filter(([name]) => name !== "kind");
  return (
    <dl className="space-y-3 text-sm">
      {fields.map(([name, value]) => (
        <div key={name}>
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {FIELD_LABELS[name] ?? name}
          </dt>
          <dd className="mt-0.5">
            <FieldValue name={name} value={value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function NotePicker({
  value,
  onChange,
  label,
}: {
  value: number | undefined;
  onChange: (n: number) => void;
  label: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-mono text-sm">{label}</span>
      <div className="flex gap-1" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            onClick={() => onChange(n)}
            className={cn(
              "size-8 rounded-md border text-sm",
              value === n ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AnnotateView({
  items,
  annotations: initial,
  grids,
}: {
  items: CalibrationItem[];
  annotations: Record<string, Annotation>;
  grids: Record<JudgeKind, Grid>;
}) {
  const [annotations, setAnnotations] = useState(initial);
  const firstTodo = items.findIndex((i) => !initial[i.id]);
  const [index, setIndex] = useState(firstTodo === -1 ? 0 : firstTodo);
  const item = items[index];
  const saved = annotations[item.id];
  const [notes, setNotes] = useState<Record<string, number>>(saved?.notes ?? {});
  const [verdict, setVerdict] = useState<Verdict | null>(saved?.verdict ?? null);
  const [comment, setComment] = useState(saved?.comment ?? "");
  const [status, setStatus] = useState<{ saving: boolean; error: string | null }>({
    saving: false,
    error: null,
  });
  const grid = grids[item.kind];
  const complete = grid.criteria.every((c) => notes[c]) && verdict !== null;
  const done = items.filter((i) => annotations[i.id]).length;

  function go(to: number) {
    const next = items[to];
    const a = annotations[next.id];
    setIndex(to);
    setNotes(a?.notes ?? {});
    setVerdict(a?.verdict ?? null);
    setComment(a?.comment ?? "");
    setStatus({ saving: false, error: null });
  }

  async function save() {
    if (!complete || !verdict) return;
    setStatus({ saving: true, error: null });
    const body = { item_id: item.id, kind: item.kind, notes, verdict, comment };
    const response = await fetch("/api/evals/annotations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!response?.ok) {
      const message = (await response?.json().catch(() => null))?.error;
      setStatus({ saving: false, error: message ?? "Enregistrement impossible, réessaie." });
      return;
    }
    setAnnotations((all) => ({
      ...all,
      [item.id]: { ...body, annotated_at: new Date().toISOString() },
    }));
    setStatus({ saving: false, error: null });
    if (index < items.length - 1) go(index + 1);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Calibration du juge</h1>
          <p className="text-sm text-muted-foreground">
            Note chaque élément avec la grille de son type, sans chercher à deviner ce qu&apos;en
            pense le juge. {done}/{items.length} annotés.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={index === 0} onClick={() => go(index - 1)}>
            <ChevronLeft aria-hidden /> Précédent
          </Button>
          <span className="font-mono text-sm">
            {item.id} · {index + 1}/{items.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={index === items.length - 1}
            onClick={() => go(index + 1)}
          >
            Suivant <ChevronRight aria-hidden />
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center gap-2">
            <BacklogKindBadge kind={item.kind} />
            {saved && (
              <span className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
                <Check className="size-3.5" aria-hidden /> annoté
              </span>
            )}
          </div>
          <ItemView item={item} />
        </section>

        <aside className="space-y-4">
          <div className="space-y-2 rounded-lg border p-4">
            {grid.criteria.map((c) => (
              <NotePicker
                key={c}
                label={c}
                value={notes[c]}
                onChange={(n) => setNotes((all) => ({ ...all, [c]: n }))}
              />
            ))}
            <div className="flex gap-2 pt-2">
              {(["acceptable", "a_reprendre"] as const).map((v) => (
                <Button
                  key={v}
                  variant={verdict === v ? "default" : "outline"}
                  size="sm"
                  onClick={() => setVerdict(v)}
                >
                  {v === "acceptable" ? "Acceptable" : "À reprendre"}
                </Button>
              ))}
            </div>
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Commentaire (facultatif)"
              rows={2}
            />
            <Button className="w-full" disabled={!complete || status.saving} onClick={save}>
              {status.saving ? "Enregistrement…" : "Enregistrer et suivant"}
            </Button>
            {status.error && <p className="text-sm text-destructive">{status.error}</p>}
          </div>
          <details className="rounded-lg border p-4 text-sm" open>
            <summary className="cursor-pointer font-medium">Grille ({item.kind})</summary>
            <div className="max-h-[50vh] overflow-y-auto">
              <Markdown source={grid.text} />
            </div>
          </details>
        </aside>
      </div>
    </div>
  );
}
