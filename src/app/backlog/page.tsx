import Link from "next/link";
import { AlertTriangle, ScrollText, SearchX } from "lucide-react";
import { BacklogItemCard } from "@/components/backlog/backlog-item";
import { DraftBacklogButton } from "@/components/backlog/draft-button";
import { ScrollToElement } from "@/components/backlog/scroll-to-element";
import { EmptyState } from "@/components/shell/states";
import { EvidenceChip, InsightChip } from "@/components/signal/chips";
import { Pill } from "@/components/signal/badges";
import { FORMAT_LABELS } from "@/lib/backlog/choose-format";
import { getDb } from "@/lib/db/client";
import { formatDate } from "@/lib/format";
import { BACKLOG_KIND_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { BACKLOG_KINDS, getBacklogScreen, type BacklogGroup } from "@/server/queries/backlog";

// A drafting from this screen (« Relancer ») takes about 30 s: one drafting call, one estimation.
export const maxDuration = 120;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function filterHref(params: { type?: string | null; insight?: string | null }) {
  const query = new URLSearchParams();
  if (params.type) query.set("type", params.type);
  if (params.insight) query.set("insight", params.insight);
  const text = query.toString();
  return text ? `/backlog?${text}` : "/backlog";
}

function PlanSummary({ group }: { group: BacklogGroup }) {
  const { plan } = group;
  if (!plan) return null;
  const range =
    plan.range.min === plan.range.max
      ? `${plan.range.min}`
      : `${plan.range.min} à ${plan.range.max}`;
  return (
    <div className="flex flex-col gap-1.5 text-[13px]">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{FORMAT_LABELS[plan.chosen]}</span>
        <span className="text-muted-foreground">
          · fourchette de l&apos;insight {range} points, confiance {plan.confidence}
        </span>
        {plan.sum !== null && (
          <span
            className={cn(
              "text-muted-foreground",
              plan.sum_outside_range && "text-amber-700 dark:text-amber-300",
            )}
          >
            · total des éléments {plan.sum} points
          </span>
        )}
        <span className="text-muted-foreground">· rédigé le {formatDate(plan.drafted_at)}</span>
      </p>
      {plan.deviation_reason ? (
        <p className="text-muted-foreground">
          Signal s&apos;écarte du format proposé par le code (
          {FORMAT_LABELS[plan.proposed].toLowerCase()}) : {plan.deviation_reason}
        </p>
      ) : (
        <p className="text-muted-foreground">Format proposé par le code : {plan.proposed_reason}</p>
      )}
      {plan.no_close_analogue && (
        <p className="flex items-start gap-1.5 text-amber-800 dark:text-amber-200">
          <AlertTriangle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          Aucun ticket livré proche : fourchette élargie et confiance basse. Les points sont à
          challenger avec l&apos;équipe.
        </p>
      )}
      {plan.sum_outside_range && plan.range_note && (
        <p className="text-amber-800 dark:text-amber-200">
          Écart à la fourchette : {plan.range_note}
        </p>
      )}
    </div>
  );
}

function Group({ group, highlighted }: { group: BacklogGroup; highlighted: string | null }) {
  const range = group.plan?.range ?? null;
  const card = (item: BacklogGroup["items"][number]) => (
    <BacklogItemCard
      key={item.id}
      item={item}
      range={range}
      highlighted={item.id === highlighted}
    />
  );
  const loose = group.items.filter(
    (i) => !i.epic_id || !group.epics.some((e) => e.id === i.epic_id),
  );
  return (
    <section className="flex flex-col gap-4 rounded-2xl border bg-muted/20 p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            <InsightChip id={group.insight.id} />
            <span>{group.insight.title}</span>
          </h3>
          <PlanSummary group={group} />
        </div>
        <DraftBacklogButton insightId={group.insight.id} label="Relancer la rédaction" />
      </header>

      {group.plan?.discoverability && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-signal/30 bg-signal-soft/40 p-4">
          <p className="font-semibold">Rien dans le backlog : la fonctionnalité existe déjà</p>
          <p>
            <span className="text-muted-foreground">Action proposée :</span>{" "}
            {group.plan.discoverability.action}
          </p>
          <p className="text-muted-foreground">{group.plan.discoverability.rationale}</p>
          <p className="flex flex-wrap items-center gap-1">
            <span className="text-muted-foreground">Preuves :</span>
            {group.plan.discoverability.evidence.map((id) => (
              <EvidenceChip key={id} id={id} />
            ))}
          </p>
        </div>
      )}

      {group.epics.map((epic) => {
        const items = group.items.filter((i) => i.epic_id === epic.id);
        if (items.length === 0) return null;
        return (
          <div key={epic.id} id={epic.id} className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5 rounded-xl border bg-card p-4">
              <p className="flex flex-wrap items-center gap-2">
                <Pill className="border-signal/40 bg-signal-soft text-signal">Epic</Pill>
                <span className="font-mono font-semibold">{epic.id}</span>
                <span className="font-semibold">{epic.title}</span>
              </p>
              {epic.goal && <p>{epic.goal}</p>}
              <p className="text-[13px] text-muted-foreground">
                Objectif : {epic.okr_refs.join(", ") || "—"}
                {epic.kpis.length > 0 && ` · KPI : ${epic.kpis.join(" ; ")}`}
              </p>
            </div>
            <div className="flex flex-col gap-3 border-l-2 border-signal/30 pl-4">
              {items.map(card)}
            </div>
          </div>
        );
      })}
      {loose.length > 0 && <div className="flex flex-col gap-3">{loose.map(card)}</div>}
    </section>
  );
}

/** Backlog (SPEC §12.6): what Signal drafted, per insight, in the format of each type. */
export default async function BacklogPage({ searchParams }: PageProps<"/backlog">) {
  const params = await searchParams;
  const typeParam = one(params.type);
  const kind = BACKLOG_KINDS.find((k) => k === typeParam) ?? null;
  const insight = one(params.insight) ?? null;
  const element = one(params.element) ?? null;
  const { groups, counts } = await getBacklogScreen(getDb(), { kind, insight });
  const total = counts.story + counts.bug + counts.tache;

  if (total === 0 && groups.length === 0 && !insight) {
    return (
      <EmptyState icon={ScrollText} title="Le backlog est vide">
        <p>
          Ouvre un insight et clique sur « Rédiger le backlog », ou demande à Signal dans le chat («
          Prépare les stories des permissions »).
        </p>
      </EmptyState>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-6">
      {element && <ScrollToElement id={element} />}
      <p className="max-w-3xl leading-relaxed text-muted-foreground">
        Epics, stories, bugs et tâches rédigés par Signal à partir des insights, estimés par
        analogie avec les tickets livrés. Les brouillons se modifient ici ; un élément envoyé se
        modifie dans Notion.
      </p>

      <nav aria-label="Filtrer par type" className="flex flex-wrap items-center gap-1.5">
        {[null, ...BACKLOG_KINDS].map((k) => (
          <Link
            key={k ?? "tous"}
            href={filterHref({ type: k, insight })}
            className={cn(
              "rounded-full border px-3 py-1 text-[13px]",
              k === kind
                ? "border-signal bg-signal-soft font-medium text-signal"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {k ? BACKLOG_KIND_LABELS[k] : "Tous"}{" "}
            <span className="tabular-nums">{k ? counts[k] : total}</span>
          </Link>
        ))}
        {insight && (
          <Link
            href={filterHref({ type: kind })}
            className="ml-2 text-[13px] font-medium text-signal underline-offset-4 hover:underline"
          >
            Voir tous les insights
          </Link>
        )}
      </nav>

      {groups.length === 0 ? (
        <EmptyState icon={SearchX} title="Aucun élément ne correspond">
          <p>
            <Link
              href="/backlog"
              className="font-medium text-signal underline-offset-4 hover:underline"
            >
              Efface les filtres
            </Link>{" "}
            pour tout revoir.
          </p>
        </EmptyState>
      ) : (
        groups.map((group) => <Group key={group.insight.id} group={group} highlighted={element} />)
      )}
    </div>
  );
}
