import Link from "next/link";
import { AlertTriangle, ScrollText, SearchX } from "lucide-react";
import { BacklogItemCard } from "@/components/backlog/backlog-item";
import { DraftBacklogButton } from "@/components/backlog/draft-button";
import { ScrollToElement } from "@/components/backlog/scroll-to-element";
import { EmptyState } from "@/components/shell/states";
import { EvidenceChip, InsightChip } from "@/components/signal/chips";
import { Pill } from "@/components/signal/badges";
import { PILL_TONES } from "@/components/signal/tones";
import { FORMAT_LABELS } from "@/lib/backlog/choose-format";
import { getDb } from "@/lib/db/client";
import { formatDate } from "@/lib/format";
import { BACKLOG_KIND_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import {
  BACKLOG_KINDS,
  getBacklogScreen,
  type BacklogGroup,
  type BacklogViewItem,
} from "@/server/queries/backlog";

// A drafting from this screen (« Relancer ») takes about 30 s: one drafting call, one estimation.
export const maxDuration = 120;

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

type Status = "brouillon" | "valide" | "envoye";

/** Status filter (ADR-040): drafts to validate, validated not sent yet, sent to Notion. */
const STATUS_FILTERS: Record<Status, { label: string; statuses: BacklogViewItem["status"][] }> = {
  brouillon: { label: "À valider", statuses: ["brouillon"] },
  valide: { label: "Validés", statuses: ["valide"] },
  envoye: { label: "Dans Notion", statuses: ["envoye", "modifie_notion"] },
};

function filterHref(params: {
  type?: string | null;
  insight?: string | null;
  statut?: string | null;
}) {
  const query = new URLSearchParams();
  if (params.statut) query.set("statut", params.statut);
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
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
        <span className="font-medium text-foreground">{FORMAT_LABELS[plan.chosen]}</span>
        <span>· fourchette {range} points</span>
        <span>· confiance {plan.confidence}</span>
        {plan.sum !== null && !plan.sum_outside_range && <span>· total {plan.sum} points</span>}
        {plan.sum !== null && plan.sum_outside_range && (
          <Pill className={PILL_TONES.risk}>
            <AlertTriangle aria-hidden />
            Total {plan.sum} points, hors fourchette
          </Pill>
        )}
        {plan.no_close_analogue && (
          <Pill className={PILL_TONES.risk}>
            <AlertTriangle aria-hidden />
            Aucun ticket livré proche
          </Pill>
        )}
        <span>· rédigé le {formatDate(plan.drafted_at)}</span>
      </p>
      <details className="group">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
          Pourquoi ce découpage
        </summary>
        <div className="mt-1.5 flex flex-col gap-1.5 leading-relaxed text-muted-foreground">
          {plan.deviation_reason ? (
            <p>
              Signal s&apos;écarte du format proposé par le code (
              {FORMAT_LABELS[plan.proposed].toLowerCase()}) : {plan.deviation_reason}
            </p>
          ) : (
            <p>Format proposé par le code : {plan.proposed_reason}</p>
          )}
          {plan.sum_outside_range && plan.range_note && (
            <p className="text-foreground">Écart à la fourchette : {plan.range_note}</p>
          )}
          {plan.no_close_analogue && (
            <p className="text-foreground">
              Aucun ticket livré proche : fourchette élargie et confiance basse. Les points sont à
              challenger avec l&apos;équipe.
            </p>
          )}
        </div>
      </details>
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
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
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
            <div className="flex flex-col gap-0.5 rounded-lg bg-muted/50 px-4 py-3">
              <p className="flex flex-wrap items-center gap-2">
                <Pill className={PILL_TONES.neutral}>Epic</Pill>
                <span className="font-mono font-semibold">{epic.id}</span>
                <span className="font-semibold">{epic.title}</span>
              </p>
              {epic.goal && <p>{epic.goal}</p>}
              <p className="text-[13px] text-muted-foreground">
                Objectif : {epic.okr_refs.join(", ") || "—"}
                {epic.kpis.length > 0 && ` · KPI : ${epic.kpis.join(" ; ")}`}
              </p>
            </div>
            <div className="flex flex-col gap-2 border-l-2 pl-4">{items.map(card)}</div>
          </div>
        );
      })}
      {loose.length > 0 && <div className="flex flex-col gap-2">{loose.map(card)}</div>}
    </section>
  );
}

/**
 * Backlog (SPEC §12.6, ADR-040): what Signal drafted, per insight, one line per item with its
 * status and actions, filtered by status (drafts to validate first) and kind.
 */
export default async function BacklogPage({ searchParams }: PageProps<"/backlog">) {
  const params = await searchParams;
  const typeParam = one(params.type);
  const kind = BACKLOG_KINDS.find((k) => k === typeParam) ?? null;
  const insight = one(params.insight) ?? null;
  const element = one(params.element) ?? null;
  const statusParam = one(params.statut);
  const status = statusParam && statusParam in STATUS_FILTERS ? (statusParam as Status) : null;
  const screen = await getBacklogScreen(getDb(), { kind, insight });
  const { counts } = screen;
  const total = counts.story + counts.bug + counts.tache;
  const allItems = screen.groups.flatMap((g) => g.items);
  const statusCounts = Object.fromEntries(
    (Object.keys(STATUS_FILTERS) as Status[]).map((k) => [
      k,
      allItems.filter((i) => STATUS_FILTERS[k].statuses.includes(i.status)).length,
    ]),
  ) as Record<Status, number>;
  const groups = status
    ? screen.groups
        .map((g) => ({
          ...g,
          items: g.items.filter((i) => STATUS_FILTERS[status].statuses.includes(i.status)),
        }))
        .filter((g) => g.items.length > 0)
    : screen.groups;

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
    <div className="mx-auto flex max-w-5xl flex-col gap-5 px-8 py-6">
      {element && <ScrollToElement id={element} />}
      <nav aria-label="Filtrer par statut" className="flex flex-wrap gap-1 border-b">
        {[null, ...(Object.keys(STATUS_FILTERS) as Status[])].map((k) => {
          const active = k === status;
          return (
            <Link
              key={k ?? "tous"}
              href={filterHref({ statut: k, type: kind, insight })}
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 font-medium",
                active
                  ? "border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {k === "brouillon" && statusCounts.brouillon > 0 && (
                <span aria-hidden className="size-2 rounded-full bg-blue-500" />
              )}
              {k ? STATUS_FILTERS[k].label : "Tous"}
              <span className="text-[13px] font-normal text-muted-foreground tabular-nums">
                {k ? statusCounts[k] : allItems.length}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-wrap items-center gap-1.5">
        {[null, ...BACKLOG_KINDS].map((k) => (
          <Link
            key={k ?? "tous"}
            href={filterHref({ statut: status, type: k, insight })}
            scroll={false}
            className={cn(
              "rounded-full border px-3 py-1 text-[13px]",
              k === kind
                ? "border-foreground bg-foreground font-medium text-background"
                : "text-muted-foreground hover:bg-muted",
            )}
          >
            {k ? BACKLOG_KIND_LABELS[k] : "Tous les types"}{" "}
            <span className="tabular-nums">{k ? counts[k] : total}</span>
          </Link>
        ))}
        {insight && (
          <Link
            href={filterHref({ statut: status, type: kind })}
            className="ml-2 text-[13px] font-medium text-signal underline-offset-4 hover:underline"
          >
            Voir tous les insights
          </Link>
        )}
      </div>

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
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <Group key={group.insight.id} group={group} highlighted={element} />
          ))}
        </div>
      )}
    </div>
  );
}
