"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PenLine, Shuffle } from "lucide-react";
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
import { formatGherkin, parseGherkin, type DraftKind } from "@/lib/backlog/draft";
import { BACKLOG_KIND_LABELS } from "@/lib/labels";
import { changeBacklogItemKindAction, patchBacklogItemAction } from "@/server/actions/backlog";
import type { BacklogViewItem } from "@/server/queries/backlog";

const FIELD = "h-9 w-full rounded-lg border border-input bg-background px-2.5 text-sm";
const LABEL = "flex flex-col gap-1 text-[13px] font-medium text-muted-foreground";
const POINTS = [1, 2, 3, 5, 8, 13];

const toLines = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

type Form = Record<string, string>;

/** The editable fields of a draft, as text (lists one per line, Gherkin as formatGherkin). */
function initialForm(item: BacklogViewItem): Form {
  return {
    title: item.title,
    points: item.points === null ? "" : String(item.points),
    evidence: item.evidence.join(", "),
    value: item.value ?? "",
    persona: item.persona ?? "",
    want: item.want ?? "",
    success_kpi: item.success_kpi ?? "",
    business_rules: item.business_rules.join("\n"),
    expected_behavior: item.expected_behavior ?? "",
    actual_behavior: item.actual_behavior ?? "",
    repro_steps: item.repro_steps.join("\n"),
    severity: item.severity ?? "majeur",
    objective: item.objective ?? "",
    definition_of_done: item.definition_of_done.join("\n"),
    risks: item.risks.join("\n"),
    acceptance_criteria: formatGherkin(item.acceptance_criteria),
  };
}

const FIELDS: Record<DraftKind, string[]> = {
  story: ["value", "persona", "want", "business_rules", "acceptance_criteria", "success_kpi"],
  bug: ["expected_behavior", "actual_behavior", "repro_steps", "severity", "acceptance_criteria"],
  tache: ["objective", "definition_of_done", "risks"],
};

const LABELS: Record<string, string> = {
  value: "Afin de…",
  persona: "En tant que…",
  want: "Je veux…",
  success_kpi: "KPI de succès",
  business_rules: "Règles de gestion (une par ligne)",
  expected_behavior: "Comportement attendu",
  actual_behavior: "Comportement constaté",
  repro_steps: "Étapes de reproduction (une par ligne)",
  severity: "Sévérité",
  objective: "Objectif",
  definition_of_done: "Définition de terminé (un critère par ligne)",
  risks: "Risques (un par ligne)",
  acceptance_criteria: "Critères d'acceptation (Gherkin)",
};

const MULTILINE = new Set([
  "business_rules",
  "repro_steps",
  "definition_of_done",
  "risks",
  "acceptance_criteria",
  "expected_behavior",
  "actual_behavior",
  "objective",
]);
const LISTS = new Set(["business_rules", "repro_steps", "definition_of_done", "risks"]);

/** Only the fields that changed, in the service's shape; an unreadable Gherkin is an error. */
function buildPatch(
  kind: DraftKind,
  initial: Form,
  form: Form,
): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};
  for (const key of ["title", "points", "evidence", ...FIELDS[kind]]) {
    if (form[key] === initial[key]) continue;
    if (key === "points") patch.points = Number(form.points);
    else if (key === "evidence")
      patch.evidence = form.evidence
        .split(/[\s,;]+/)
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    else if (key === "acceptance_criteria") {
      const parsed = parseGherkin(form.acceptance_criteria);
      if (!parsed.ok) return { error: parsed.error };
      patch.acceptance_criteria = parsed.scenarios;
    } else if (LISTS.has(key)) patch[key] = toLines(form[key]);
    else patch[key] = form[key].trim();
  }
  return { patch };
}

function useRun() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (
    action: () => Promise<{ ok: true } | { ok: false; message: string }>,
    onDone: () => void,
  ) =>
    startTransition(async () => {
      setError(null);
      const response = await action();
      if (!response.ok) {
        setError(response.message);
        return;
      }
      onDone();
      router.refresh();
    });
  return { pending, error, setError, run };
}

/** « Modifier » and « Changer de type » of a draft (SPEC §12.6); each change is a PO decision. */
export function BacklogItemActions({ item }: { item: BacklogViewItem }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <EditDialog item={item} />
      <KindDialog item={item} />
    </div>
  );
}

function EditDialog({ item }: { item: BacklogViewItem }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(() => initialForm(item));
  const [reason, setReason] = useState("");
  const { pending, error, setError, run } = useRun();
  const set = (key: string) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = () => {
    const built = buildPatch(item.kind, initialForm(item), form);
    if ("error" in built) return setError(built.error);
    if (Object.keys(built.patch).length === 0) return setError("Rien n'a changé.");
    run(
      () => patchBacklogItemAction(item.id, built.patch, reason.trim() || undefined),
      () => setOpen(false),
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) {
          setForm(initialForm(item));
          setReason("");
          setError(null);
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <PenLine aria-hidden />
        Modifier
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Modifier {item.id} ({BACKLOG_KIND_LABELS[item.kind]})
          </DialogTitle>
          <DialogDescription>
            Brouillon seulement. La modification est journalisée comme ta décision ; de nouveaux
            points recalculent l&apos;effort de l&apos;insight.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className={LABEL}>
            Titre
            <Input value={form.title} onChange={set("title")} maxLength={120} />
          </label>
          {FIELDS[item.kind].map((key) =>
            key === "severity" ? (
              <label key={key} className={LABEL}>
                {LABELS[key]}
                <select className={FIELD} value={form.severity} onChange={set("severity")}>
                  <option value="bloquant">Bloquant</option>
                  <option value="majeur">Majeur</option>
                  <option value="mineur">Mineur</option>
                </select>
              </label>
            ) : (
              <label key={key} className={LABEL}>
                {LABELS[key]}
                {MULTILINE.has(key) ? (
                  <Textarea
                    value={form[key]}
                    onChange={set(key)}
                    rows={key === "acceptance_criteria" ? 10 : 3}
                    className={key === "acceptance_criteria" ? "font-mono text-[13px]" : undefined}
                  />
                ) : (
                  <Input value={form[key]} onChange={set(key)} />
                )}
              </label>
            ),
          )}
          {item.kind !== "tache" && (
            <p className="text-[12px] text-muted-foreground">
              Gherkin : « Scénario : … » ou « Scénario (cas limite) : … », puis une étape par ligne
              (Étant donné, Quand, Alors, Et, Mais). 2 à 5 scénarios, dont un cas limite.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              Points
              <select className={FIELD} value={form.points} onChange={set("points")}>
                {form.points === "" && <option value="">—</option>}
                {POINTS.map((p) => (
                  <option key={p} value={String(p)}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL}>
              Preuves (retours de l&apos;insight)
              <Input value={form.evidence} onChange={set("evidence")} />
            </label>
          </div>
          <label className={LABEL}>
            Raison (facultative)
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </label>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={pending}>
            {pending && <Loader2 aria-hidden className="animate-spin" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KindDialog({ item }: { item: BacklogViewItem }) {
  const [open, setOpen] = useState(false);
  const others = (["story", "bug", "tache"] as const).filter((k) => k !== item.kind);
  const [kind, setKind] = useState<DraftKind>(others[0]);
  const [reason, setReason] = useState("");
  const { pending, error, setError, run } = useRun();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (next) {
          setKind(others[0]);
          setReason("");
          setError(null);
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="ghost" />}>
        <Shuffle aria-hidden />
        Changer de type
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Changer le type de {item.id}</DialogTitle>
          <DialogDescription>
            Signal régénère l&apos;élément entièrement au format du nouveau type, avec un nouvel ID.
            Les points et les preuves sont conservés ; la décision est journalisée.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className={LABEL}>
            Nouveau type
            <select
              className={FIELD}
              value={kind}
              onChange={(e) => setKind(e.target.value as DraftKind)}
            >
              {others.map((k) => (
                <option key={k} value={k}>
                  {BACKLOG_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Raison (facultative)
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </label>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={() =>
              run(
                () => changeBacklogItemKindAction(item.id, kind, reason.trim() || undefined),
                () => setOpen(false),
              )
            }
            disabled={pending}
          >
            {pending && <Loader2 aria-hidden className="animate-spin" />}
            {pending ? "Régénération…" : `Régénérer en ${BACKLOG_KIND_LABELS[kind].toLowerCase()}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
