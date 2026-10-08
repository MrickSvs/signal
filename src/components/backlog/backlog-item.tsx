import { BadgeCheck, CircleAlert, Link2, Scale, ThumbsUp } from "lucide-react";
import { BacklogItemChip, EvidenceChip } from "@/components/signal/chips";
import { BacklogKindBadge, Pill } from "@/components/signal/badges";
import { PILL_TONES, TEXT_TONES } from "@/components/signal/tones";
import { storyPart, type Scenario } from "@/lib/backlog/draft";
import { formatNumber } from "@/lib/format";
import { BACKLOG_STATUS_LABELS, JUDGE_CRITERION_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { BacklogViewItem, JudgeBadge } from "@/server/queries/backlog";
import { BacklogItemActions, ReviewDialog } from "./item-actions";
import { ItemDisclosure } from "./item-disclosure";
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
              <span className="ml-2 font-sans text-[12px] text-muted-foreground">cas limite</span>
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
      className={ready ? PILL_TONES.signal : PILL_TONES.risk}
      title={judge.provisional ? "Badge provisoire : juge non calibré" : "Note du juge qualité"}
    >
      {ready ? <BadgeCheck aria-hidden /> : <CircleAlert aria-hidden />}
      Qualité {formatNumber(judge.note)}/5
    </Pill>
  );
}

/** The quality judge's review (SPEC §14.3): advice for the PO before validating, never applied
 * automatically. Verdict and overall note, one chip per criterion, the strength, what to check. */
function JudgePanel({ judge }: { judge: JudgeBadge }) {
  const ready = judge.verdict === "pret";
  const notes = Object.entries(judge.notes);
  return (
    <section
      aria-label="Avis du juge qualité"
      className="flex flex-col gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-[13px]"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Scale aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="font-medium">Avis du juge</span>
        <span className={cn("font-medium", ready ? TEXT_TONES.signal : TEXT_TONES.risk)}>
          {ready ? "Prêt" : "À revoir"} · {formatNumber(judge.note)}/5
        </span>
        <span className="text-muted-foreground">
          relecture par un second modèle{judge.provisional ? " (provisoire)" : ""}
        </span>
      </div>
      {notes.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Notes par critère">
          {notes.map(([criterion, note]) => (
            <li
              key={criterion}
              className={cn(
                "rounded-md border bg-background px-2 py-0.5",
                note <= 2 && PILL_TONES.risk,
              )}
            >
              {JUDGE_CRITERION_LABELS[criterion] ?? criterion}{" "}
              <span className="font-medium tabular-nums">{note}/5</span>
            </li>
          ))}
        </ul>
      )}
      {judge.points_forts && (
        <p className="flex items-start gap-1.5 text-muted-foreground">
          <ThumbsUp aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          {judge.points_forts}
        </p>
      )}
      {judge.a_ameliorer.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="font-medium">À vérifier avant de valider</p>
          <ul className="flex list-disc flex-col gap-1 pl-5 leading-relaxed">
            {judge.a_ameliorer.map((advice, i) => (
              <li key={i}>{advice}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const STATUS_STYLES: Record<BacklogViewItem["status"], string> = {
  brouillon: PILL_TONES.po,
  valide: PILL_TONES.neutral,
  envoye: PILL_TONES.neutral,
  modifie_notion: PILL_TONES.neutral,
  rejete: PILL_TONES.neutral,
};

const STATUS_LABELS: Record<BacklogViewItem["status"], string> = {
  ...BACKLOG_STATUS_LABELS,
  brouillon: "À valider",
  envoye: "Dans Notion",
};

/**
 * One story, bug or technical task (SPEC §9.1 to §9.3, ADR-040): one line with its status and its
 * actions, the content in the format of its type unfolding below.
 */
export function BacklogItemCard({
  item,
  range,
  highlighted,
  notion,
}: {
  item: BacklogViewItem;
  range: { min: number; max: number } | null;
  highlighted: boolean;
  /** Notion is configured: « Valider et envoyer » is offered (services/notion/client). */
  notion: boolean;
}) {
  const sent = item.status === "envoye" || item.status === "modifie_notion";
  return (
    <article
      id={item.id}
      className={cn(
        "flex scroll-mt-20 flex-col gap-3 rounded-lg border bg-card px-4 py-3",
        highlighted && "ring-2 ring-blue-500/60",
      )}
    >
      <ItemDisclosure
        id={item.id}
        defaultOpen={highlighted}
        summary={
          <>
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
              <BacklogKindBadge kind={item.kind} />
              <span className="font-mono font-semibold">{item.id}</span>
              <Pill className={STATUS_STYLES[item.status]}>{STATUS_LABELS[item.status]}</Pill>
              <JudgeView judge={item.judge} />
              <span className="text-muted-foreground tabular-nums">
                {item.points === null ? "non estimé" : `${item.points} points`}
              </span>
            </span>
            <span className="leading-snug font-medium">{item.title}</span>
          </>
        }
        actions={
          <>
            {item.status === "brouillon" && (
              <>
                {notion && <PushButton item={item} />}
                <ReviewDialog item={item} status="valide" notion={notion} />
                <ReviewDialog item={item} status="rejete" notion={notion} />
                <BacklogItemActions item={item} />
              </>
            )}
            {item.status === "valide" &&
              (notion ? (
                <PushButton item={item} />
              ) : (
                <span
                  className="text-[13px] text-muted-foreground"
                  title="Il est validé ; tu pourras l'envoyer dans Notion une fois Notion branché."
                >
                  Prêt à partir : Notion n&apos;est pas branché.
                </span>
              ))}
            {sent && item.notion_page_id && <NotionLink pageId={item.notion_page_id} />}
          </>
        }
      >
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
            <Block title="Comportement attendu">
              <p>{item.expected_behavior}</p>
            </Block>
            <Block title="Comportement constaté">
              <p>{item.actual_behavior}</p>
            </Block>
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

        <Block title="Estimation">
          <div className="flex flex-col gap-1.5 text-[13px]">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold">
                {item.points === null ? "Non estimé" : `${item.points} points`}
              </span>
              {range && (
                <span className="text-muted-foreground">
                  · fourchette de l&apos;insight{" "}
                  {range.min === range.max ? range.min : `${range.min} à ${range.max}`} points
                </span>
              )}
            </p>
            {item.estimate && item.estimate.components.length > 0 && (
              <p className="text-muted-foreground">
                Composants :{" "}
                <span className="font-mono">{item.estimate.components.join(", ")}</span>
              </p>
            )}
            {item.estimate && item.estimate.analogues.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {item.estimate.analogues.map((a) => (
                  <li
                    key={a.ticket_id}
                    className="rounded-md border px-2 py-0.5 text-muted-foreground"
                  >
                    <span className="font-mono text-foreground">{a.ticket_id}</span>{" "}
                    {a.estimated_points ?? "?"} pts estimés, {a.actual_points ?? "?"} réels
                    {a.close ? "" : ", éloigné"}
                  </li>
                ))}
              </ul>
            )}
            {item.estimate?.rationale && (
              <p className="leading-relaxed text-muted-foreground">{item.estimate.rationale}</p>
            )}
          </div>
        </Block>

        {(item.dependencies.length > 0 || item.evidence.length > 0) && (
          <div className="flex flex-col gap-1.5 text-[13px]">
            {item.dependencies.length > 0 && (
              <p className="flex flex-wrap items-center gap-1.5">
                <Link2 aria-hidden className="size-3.5 text-muted-foreground" />
                <span className="text-muted-foreground">Dépend de</span>
                {item.dependencies.map((id) => (
                  <BacklogItemChip key={id} id={id} />
                ))}
              </p>
            )}
            {item.evidence.length > 0 && (
              <p className="flex flex-wrap items-center gap-1">
                <span className="text-muted-foreground">Preuves :</span>
                {item.evidence.map((id) => (
                  <EvidenceChip key={id} id={id} />
                ))}
              </p>
            )}
          </div>
        )}

        {item.judge && <JudgePanel judge={item.judge} />}
        {sent && (
          <p className="text-[13px] text-muted-foreground">
            Envoyé dans Notion : il se modifie dans Notion.
          </p>
        )}
      </ItemDisclosure>

      {item.status === "valide" && item.push_error && (
        <p role="alert" className="flex items-start gap-1.5 pl-6 text-[13px] text-destructive">
          <CircleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          Envoi vers Notion en échec : {item.push_error}
        </p>
      )}
    </article>
  );
}
