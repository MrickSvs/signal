import { AlertTriangle, BadgeCheck, CircleAlert, Link2 } from "lucide-react";
import { BacklogItemChip, EvidenceChip } from "@/components/signal/chips";
import { BacklogKindBadge, Pill } from "@/components/signal/badges";
import { storyPart, type Scenario } from "@/lib/backlog/draft";
import { formatNumber } from "@/lib/format";
import { BACKLOG_STATUS_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { BacklogViewItem, JudgeBadge } from "@/server/queries/backlog";
import { BacklogItemActions } from "./item-actions";
import { NotionLink, PushButton } from "./push-button";

const SEVERITY_LABELS = { bloquant: "Bloquant", majeur: "Majeur", mineur: "Mineur" } as const;

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h5 className="text-[13px] font-medium text-muted-foreground">{title}</h5>
      {children}
    </div>
  );
}

function Lines({ items, ordered = false }: { items: string[]; ordered?: boolean }) {
  const List = ordered ? "ol" : "ul";
  return (
    <List className={cn("flex flex-col gap-0.5 pl-5", ordered ? "list-decimal" : "list-disc")}>
      {items.map((line, i) => (
        <li key={i}>{line}</li>
      ))}
    </List>
  );
}

/** Gherkin with its keywords in bold (SPEC §12.6). */
export function Gherkin({ scenarios }: { scenarios: Scenario[] }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/60 px-3 py-2.5 font-mono text-[13px] leading-relaxed">
      {scenarios.map((s, i) => (
        <div key={i}>
          <p>
            <strong>Scénario :</strong> {s.name}
            {s.edge_case && (
              <span className="ml-2 font-sans text-[12px] text-amber-700 dark:text-amber-300">
                cas limite
              </span>
            )}
          </p>
          {s.steps.map((step, j) => (
            <p key={j} className="pl-4">
              <strong>{step.keyword}</strong> {step.text}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

function JudgeView({ judge }: { judge: JudgeBadge | null }) {
  if (!judge) {
    return (
      <Pill
        className="border-border text-muted-foreground"
        title="Le juge évalue l'élément après sa rédaction"
      >
        Qualité : en cours
      </Pill>
    );
  }
  const ready = judge.verdict === "pret";
  return (
    <Pill
      className={
        ready
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
          : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
      }
      title={[
        judge.points_forts,
        ...Object.entries(judge.notes).map(([criterion, n]) => `${criterion} : ${n}/5`),
        ...judge.a_ameliorer.map((a) => `À améliorer : ${a}`),
        judge.provisional ? "Badge provisoire (juge non calibré)." : "",
      ]
        .filter(Boolean)
        .join("\n")}
    >
      {ready ? <BadgeCheck aria-hidden /> : <CircleAlert aria-hidden />}
      Qualité {formatNumber(judge.note)}/5
    </Pill>
  );
}

/** One story, bug or technical task, in the format of its type (SPEC §9.1 to §9.3). */
export function BacklogItemCard({
  item,
  range,
  highlighted,
}: {
  item: BacklogViewItem;
  range: { min: number; max: number } | null;
  highlighted: boolean;
}) {
  return (
    <article
      id={item.id}
      className={cn(
        "flex scroll-mt-20 flex-col gap-3 rounded-xl border bg-card p-4",
        highlighted && "ring-2 ring-signal",
      )}
    >
      <header className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <BacklogKindBadge kind={item.kind} />
          <span className="font-mono font-semibold">{item.id}</span>
          <Pill className="border-border text-muted-foreground">
            {BACKLOG_STATUS_LABELS[item.status]}
          </Pill>
          <JudgeView judge={item.judge} />
        </div>
        <h4 className="font-semibold">{item.title}</h4>
      </header>

      {item.kind === "story" && (
        <p className="leading-relaxed">
          <strong>Afin de</strong> {storyPart("value", item.value)},<br />
          <strong>en tant que</strong> {storyPart("persona", item.persona)},<br />
          <strong>je veux</strong> {storyPart("want", item.want)}.
        </p>
      )}
      {item.kind === "bug" && (
        <>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              Sévérité : <strong>{item.severity ? SEVERITY_LABELS[item.severity] : "—"}</strong>
            </span>
            <span title={item.affected_accounts.join(", ")}>
              Comptes touchés : <strong>{item.affected_accounts.length}</strong>
              {item.enterprise_accounts > 0 && ` dont ${item.enterprise_accounts} Enterprise`}
            </span>
          </p>
          <div className="flex flex-col gap-3">
            <Block title="Comportement attendu">
              <p>{item.expected_behavior}</p>
            </Block>
            <Block title="Comportement constaté">
              <p>{item.actual_behavior}</p>
            </Block>
          </div>
          <Block title="Étapes de reproduction">
            <Lines items={item.repro_steps} ordered />
          </Block>
        </>
      )}
      {item.kind === "tache" && (
        <>
          <Block title="Objectif">
            <p>{item.objective}</p>
          </Block>
          <Block title="Définition de terminé">
            <Lines items={item.definition_of_done} />
          </Block>
          {item.risks.length > 0 && (
            <Block title="Risques">
              <Lines items={item.risks} />
            </Block>
          )}
        </>
      )}

      {item.kind === "story" && item.business_rules.length > 0 && (
        <Block title="Règles de gestion">
          <Lines items={item.business_rules} />
        </Block>
      )}
      {item.kind !== "tache" && item.acceptance_criteria.length > 0 && (
        <Block title="Critères d'acceptation">
          <Gherkin scenarios={item.acceptance_criteria} />
        </Block>
      )}
      {item.kind === "story" && item.success_kpi && (
        <p>
          <span className="text-muted-foreground">KPI de succès :</span> {item.success_kpi}
        </p>
      )}

      <div className="flex flex-col gap-1.5 border-t pt-3 text-[13px]">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold">
            {item.points === null ? "Non estimé" : `${item.points} points`}
          </span>
          {item.estimate && item.estimate.components.length > 0 && (
            <span className="text-muted-foreground">
              — composants :{" "}
              <span className="font-mono">{item.estimate.components.join(", ")}</span>
            </span>
          )}
          {item.estimate?.analogues.map((a) => (
            <span key={a.ticket_id} className="text-muted-foreground">
              · analogue <span className="font-mono">{a.ticket_id}</span> (
              {a.estimated_points ?? "?"} pts estimés, {a.actual_points ?? "?"} réels
              {a.close ? "" : ", éloigné"})
            </span>
          ))}
          {range && (
            <span className="text-muted-foreground">
              · fourchette de l&apos;insight :{" "}
              {range.min === range.max ? range.min : `${range.min} à ${range.max}`} points
            </span>
          )}
        </p>
        {item.estimate?.rationale && (
          <p className="text-muted-foreground">{item.estimate.rationale}</p>
        )}
        {item.dependencies.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5">
            <Link2 aria-hidden className="size-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">Dépend de</span>
            {item.dependencies.map((id) => (
              <BacklogItemChip key={id} id={id} />
            ))}
          </p>
        )}
        <p className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground">Preuves :</span>
          {item.evidence.map((id) => (
            <EvidenceChip key={id} id={id} />
          ))}
        </p>
        {item.judge && item.judge.a_ameliorer.length > 0 && (
          <p className="flex items-start gap-1.5 text-amber-800 dark:text-amber-200">
            <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            {item.judge.a_ameliorer.join(" · ")}
          </p>
        )}
      </div>

      {item.status === "valide" && item.push_error && (
        <p role="alert" className="flex items-start gap-1.5 text-[13px] text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          Envoi vers Notion en échec : {item.push_error}
        </p>
      )}
      {item.status === "brouillon" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <PushButton item={item} />
          <BacklogItemActions item={item} />
        </div>
      )}
      {item.status === "valide" && <PushButton item={item} />}
      {(item.status === "envoye" || item.status === "modifie_notion") && (
        <div className="flex flex-wrap items-center gap-2">
          {item.notion_page_id && <NotionLink pageId={item.notion_page_id} />}
          <span className="text-[13px] text-muted-foreground">
            Envoyé dans Notion : il se modifie dans Notion.
          </span>
        </div>
      )}
    </article>
  );
}
