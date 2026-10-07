import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  GitMerge,
  ListChecks,
  SlidersHorizontal,
} from "lucide-react";
import { AskSignalButton } from "@/components/chat/ask-signal-button";
import { ChannelBadge, Pill, PlanBadge } from "@/components/signal/badges";
import { EvidenceChip, InsightChip } from "@/components/signal/chips";
import { MetricWithSource } from "@/components/signal/metric-with-source";
import { buttonVariants } from "@/components/ui/button";
import { recommendationPrompt } from "@/lib/chat/suggestions";
import type { Database } from "@/lib/db/types";
import {
  evidenceNotInText,
  pendingDecisions,
  type DigestPulse,
  type PendingDecision,
  type Recommendation,
} from "@/lib/digest/content";
import { formatDateTime, formatEur, formatNumber } from "@/lib/format";
import { CHANNEL_LABELS, HEALTH_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { DigestFacts } from "@/pipeline/nodes/digest";
import type { OpenAlert } from "@/server/queries/shell";
import { AlertRow } from "./alert-row";
import { IdText } from "./id-text";
import { InboxGroup, InboxMeta, InboxRow, TONES, type InboxTone } from "./inbox";
import { Sparkline } from "./sparkline";

type Enums = Database["public"]["Enums"];

const MAX_CHIPS = 3;
const MAX_NEW_INSIGHTS = 6;
const MAX_PENDING_CHIPS = 8;
const EVIDENCE_IN_POPOVER = 24;

function Chips({ ids, max = MAX_CHIPS }: { ids: readonly string[]; max?: number }) {
  return (
    <>
      {ids.slice(0, max).map((id) => (
        <EvidenceChip key={id} id={id} />
      ))}
      {ids.length > max && <span className="text-muted-foreground">+{ids.length - max}</span>}
    </>
  );
}

/** A titled block, also used by other screens. */
export function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-baseline gap-2 text-base font-semibold">
        {title}
        {count !== undefined && count > 0 && (
          <span className="font-normal text-muted-foreground tabular-nums">{count}</span>
        )}
      </h3>
      {children}
    </section>
  );
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="scroll-mt-4 text-base font-semibold">
      {children}
    </h3>
  );
}

// Counters ------------------------------------------------------------------------------------

/** The counters under the greeting, each leading to its section (SPEC §12.2). */
export function PulseBar({ pulse }: { pulse: DigestPulse }) {
  const cells = [
    {
      n: pulse.alerts,
      one: "alerte ouverte",
      many: "alertes ouvertes",
      href: "#a-traiter",
      tone: "alert" as InboxTone,
    },
    {
      n: pulse.recommendations,
      one: "recommandation",
      many: "recommandations",
      href: "#a-traiter",
      tone: "recommendation" as InboxTone,
    },
    {
      n: pulse.pending,
      one: "décision en attente",
      many: "décisions en attente",
      href: "#a-traiter",
      tone: "decision" as InboxTone,
    },
    {
      n: pulse.accountsAtRisk,
      one: "compte à risque",
      many: "comptes à risque",
      href: "#ce-qui-bouge",
    },
    {
      n: pulse.newFeedbacks,
      one: "nouveau retour",
      many: "nouveaux retours",
      href: "#ce-qui-bouge",
    },
  ];
  return (
    <nav
      aria-label="En bref"
      className="grid grid-cols-3 overflow-hidden rounded-lg border @xl:grid-cols-5"
    >
      {cells.map((cell) => (
        <a
          key={cell.one}
          href={cell.href}
          className="-mr-px -mb-px flex flex-col border-r border-b px-3 py-2 hover:bg-muted/60"
        >
          <span
            className={cn(
              "text-xl font-semibold tabular-nums",
              cell.n === 0
                ? "font-medium text-muted-foreground"
                : "tone" in cell && cell.tone && TONES[cell.tone].text,
            )}
          >
            {formatNumber(cell.n)}
          </span>
          <span className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
            {"tone" in cell && cell.tone && (
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  cell.n === 0 ? "bg-border" : TONES[cell.tone].dot,
                )}
              />
            )}
            {cell.n > 1 ? cell.many : cell.one}
          </span>
        </a>
      ))}
    </nav>
  );
}

// À traiter -----------------------------------------------------------------------------------

const MAX_EVIDENCE = 4;

/** Evidence chips the text does not already cite, capped. */
function Evidence({ ids }: { ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <>
      <IdText text={ids.slice(0, MAX_EVIDENCE).join(" ")} bare />
      {ids.length > MAX_EVIDENCE && (
        <span className="text-muted-foreground">+{ids.length - MAX_EVIDENCE}</span>
      )}
    </>
  );
}

function RecommendationRow({ index, r }: { index: number; r: Recommendation }) {
  const evidence = evidenceNotInText(r.preuves, [r.titre, r.justification]);
  return (
    <InboxRow
      tone="recommendation"
      marker={index + 1}
      title={<IdText text={r.titre} bare />}
      summary={r.justification ? <IdText text={r.justification} bare /> : undefined}
      meta={
        <InboxMeta confidence={r.confiance} label={evidence.length ? "Preuves" : undefined}>
          {evidence.length > 0 && <Evidence ids={evidence} />}
        </InboxMeta>
      }
      actions={<AskSignalButton size="sm" prompt={recommendationPrompt(r.titre, r.preuves)} />}
    />
  );
}

const DECISION_ICONS = { relation: GitMerge, override: SlidersHorizontal, list: ListChecks };

function DecisionRow({ row }: { row: PendingDecision }) {
  const Icon = row.relation
    ? DECISION_ICONS.relation
    : row.param
      ? DECISION_ICONS.override
      : DECISION_ICONS.list;
  return (
    <InboxRow
      tone="decision"
      marker={<Icon aria-hidden />}
      title={row.label}
      meta={
        <InboxMeta>
          {row.relation ? (
            <>
              <InsightChip id={row.relation.left} />
              <span className="text-muted-foreground">{row.relation.verb}</span>
              <InsightChip id={row.relation.right} />
            </>
          ) : (
            <>
              <IdText text={row.ids.slice(0, MAX_PENDING_CHIPS).join(" ")} bare />
              {row.ids.length > MAX_PENDING_CHIPS && (
                <span className="text-muted-foreground">+{row.ids.length - MAX_PENDING_CHIPS}</span>
              )}
              {row.param && <span className="text-muted-foreground">paramètre {row.param}</span>}
            </>
          )}
        </InboxMeta>
      }
      actions={
        <Link href={row.href} className={buttonVariants({ variant: "outline", size: "sm" })}>
          {row.action}
          <ArrowRight aria-hidden />
        </Link>
      }
    />
  );
}

/** Open alerts, then Signal's recommendations, then pending decisions (SPEC §12.2, ADR-033). */
export function InboxSection({
  alerts,
  recommendations,
  pending,
}: {
  alerts: OpenAlert[];
  recommendations: Recommendation[];
  pending: DigestFacts["pending"];
}) {
  const decisions = pendingDecisions(pending);
  if (alerts.length + recommendations.length + decisions.length === 0) return null;
  return (
    <section aria-labelledby="a-traiter" className="flex flex-col gap-3">
      <SectionTitle id="a-traiter">À traiter</SectionTitle>
      <ul className="flex flex-col divide-y overflow-hidden rounded-lg border">
        {alerts.length > 0 && (
          <InboxGroup
            tone="alert"
            label={alerts.length > 1 ? "Alertes" : "Alerte"}
            count={alerts.length}
          >
            {alerts.map((alert) => (
              <AlertRow key={alert.id} alert={alert} />
            ))}
          </InboxGroup>
        )}
        {recommendations.length > 0 && (
          <InboxGroup
            tone="recommendation"
            label="Recommandations de Signal"
            count={recommendations.length}
          >
            {recommendations.map((r, index) => (
              <RecommendationRow key={index} index={index} r={r} />
            ))}
          </InboxGroup>
        )}
        {decisions.length > 0 && (
          <InboxGroup tone="decision" label="Décisions en attente" count={decisions.length}>
            {decisions.map((row) => (
              <DecisionRow key={row.key} row={row} />
            ))}
          </InboxGroup>
        )}
      </ul>
    </section>
  );
}

// Ce qui bouge --------------------------------------------------------------------------------

function RadarCard({
  title,
  count,
  link,
  wide,
  children,
}: {
  title: string;
  count?: string;
  link?: { href: string; label: string };
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col rounded-lg border", wide && "@3xl:col-span-2")}>
      <div className="flex items-baseline gap-2 border-b px-4 py-2">
        <h4 className="font-semibold">{title}</h4>
        {count && <span className="text-muted-foreground tabular-nums">{count}</span>}
        {link && (
          <Link
            href={link.href}
            className="ml-auto inline-flex items-center gap-1 text-[13px] font-medium text-signal underline-offset-4 hover:underline"
          >
            {link.label}
            <ArrowRight aria-hidden className="size-3" />
          </Link>
        )}
      </div>
      <ul className="flex flex-col divide-y">{children}</ul>
    </div>
  );
}

function TrendsCard({
  emerging,
  newInsights,
  weekly,
  first,
}: {
  emerging: DigestFacts["emerging"];
  newInsights: DigestFacts["new_insights"];
  weekly: Map<string, number[]>;
  first: boolean;
}) {
  const emergingIds = new Set(emerging.map((e) => e.insight_id));
  const fresh = newInsights.filter((i) => !emergingIds.has(i.insight_id));
  const shownFresh = fresh.slice(0, MAX_NEW_INSIGHTS);
  const row = (id: string, title: string, right: React.ReactNode) => {
    const points = weekly.get(id);
    return (
      <li key={id} className="flex items-center gap-3 px-4 py-2">
        <span
          className="w-24 shrink-0"
          title="Retours par semaine sur 6 semaines, le dernier point couvre les 7 derniers jours"
        >
          {points ? (
            <Sparkline weekly={points} />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <InsightChip id={id} title={title} />
        </span>
        <span className="flex shrink-0 items-center gap-2">{right}</span>
      </li>
    );
  };
  return (
    <RadarCard
      title={emerging.length ? "Tendances émergentes" : "Sujets nouveaux"}
      count={formatNumber(emerging.length + fresh.length)}
      wide
    >
      {[...emerging]
        .sort((a, b) => b.recent - a.recent || b.growth - a.growth)
        .map((e) =>
          row(
            e.insight_id,
            e.title,
            <MetricWithSource
              label="Retours des 7 derniers jours"
              value={formatNumber(e.recent)}
              unit="sur 7 jours"
              source="calcule"
              breakdown={[
                { label: "7 derniers jours", value: formatNumber(e.recent) },
                { label: "Croissance vs la base", value: `×${formatNumber(e.growth)}` },
              ]}
              evidence={e.recent_feedback_ids}
            />,
          ),
        )}
      {shownFresh.map((i) =>
        row(
          i.insight_id,
          i.title,
          <Pill className="border-border text-muted-foreground">
            {i.ranked ? "Nouveau · classé" : "Nouveau · signal faible"}
          </Pill>,
        ),
      )}
      {fresh.length > shownFresh.length && (
        <li className="px-4 py-2">
          <Link
            href="/insights?statut=propose"
            className="font-medium text-signal underline-offset-4 hover:underline"
          >
            {first ? "Tous les sujets du premier run" : "Les autres sujets nouveaux"} (
            {formatNumber(fresh.length - shownFresh.length)} de plus)
          </Link>
        </li>
      )}
    </RadarCard>
  );
}

function MovesCard({ moves, wide }: { moves: DigestFacts["ranking"]["moves"]; wide: boolean }) {
  return (
    <RadarCard
      title="Classement"
      count={formatNumber(moves.length)}
      link={{ href: "/priorisation", label: "Priorisation" }}
      wide={wide}
    >
      {moves.map((m) => {
        const up = m.from !== null && m.to !== null && m.to < m.from;
        const Icon = m.to === null ? ArrowDown : m.from === null || up ? ArrowUp : ArrowDown;
        return (
          <li key={m.insight_id} className="flex items-center gap-3 px-4 py-2">
            <Icon
              aria-hidden
              className={cn(
                "size-4 shrink-0",
                Icon === ArrowUp ? "text-signal" : "text-muted-foreground",
              )}
            />
            <span className="min-w-0 flex-1">
              <InsightChip id={m.insight_id} title={m.title} />
            </span>
            <span className="shrink-0 text-muted-foreground tabular-nums">
              {m.from === null
                ? `entre au rang ${m.to}`
                : m.to === null
                  ? `sort (était ${m.from})`
                  : `${m.from} → ${m.to}`}
            </span>
          </li>
        );
      })}
    </RadarCard>
  );
}

const HEALTH_DOTS: Record<Enums["customer_health"], string> = {
  vert: "bg-emerald-500",
  orange: "bg-amber-500",
  rouge: "bg-red-500",
};

function AccountsCard({
  accounts,
  mrr,
  wide,
}: {
  accounts: DigestFacts["accounts_at_risk"];
  mrr: Map<string, number>;
  wide: boolean;
}) {
  return (
    <RadarCard title="Comptes à risque" count={formatNumber(accounts.length)} wide={wide}>
      {accounts.map((a) => {
        const value = mrr.get(a.customer_id);
        const health = a.health as Enums["customer_health"] | null;
        return (
          <li key={a.customer_id} className="flex flex-col gap-1.5 px-4 py-2.5">
            <div className="flex items-center gap-2">
              {health && (
                <span
                  role="img"
                  aria-label={HEALTH_LABELS[health]}
                  title={HEALTH_LABELS[health]}
                  className={cn("size-2.5 shrink-0 rounded-full", HEALTH_DOTS[health])}
                />
              )}
              <span className="truncate font-medium">{a.name}</span>
              <PlanBadge plan={a.plan as Enums["customer_plan"] | null} />
              <span className="ml-auto flex shrink-0 items-center gap-2 tabular-nums">
                <span title="Renouvellement">J+{a.renewal_in_days}</span>
                {value !== undefined && (
                  <MetricWithSource
                    label={`MRR de ${a.name}`}
                    value={formatEur(value)}
                    breakdown={[
                      { label: "Compte", value: a.customer_id },
                      { label: "MRR mensuel", value: formatEur(value) },
                      { label: "Renouvellement", value: `J+${a.renewal_in_days}` },
                    ]}
                    rationale="MRR du compte dans la base clients."
                  />
                )}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-1 pl-[1.125rem]">
              <span className="font-mono text-[13px] text-muted-foreground">{a.customer_id}</span>
              {a.insight_ids.map((id) => (
                <InsightChip key={id} id={id} />
              ))}
              {a.churn_feedback_ids.length > 0 && (
                <>
                  <span className="text-muted-foreground">churn</span>
                  <Chips ids={a.churn_feedback_ids} />
                </>
              )}
            </div>
          </li>
        );
      })}
    </RadarCard>
  );
}

function FeedbacksCard({
  feedbacks,
  since,
  first,
}: {
  feedbacks: DigestFacts["feedbacks"];
  since: string | null;
  /** First digest: every topic is new, « confirms a known topic » means nothing yet. */
  first: boolean;
}) {
  const channels = Object.entries(feedbacks.by_channel).sort(([, a], [, b]) => b - a) as [
    Enums["feedback_channel"],
    number,
  ][];
  const shown = (ids: string[]) =>
    ids.length > EVIDENCE_IN_POPOVER
      ? `Les ${EVIDENCE_IN_POPOVER} premiers ; tous sont dans l'écran Retours.`
      : null;
  return (
    <RadarCard title="Nouveaux retours" link={{ href: "/retours", label: "Retours" }} wide>
      <li className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2.5">
        <MetricWithSource
          label="Nouveaux retours sur la période"
          value={formatNumber(feedbacks.total)}
          unit={feedbacks.total > 1 ? "retours" : "retour"}
          source="calcule"
          breakdown={[
            ...channels.map(([channel, n]) => ({
              label: CHANNEL_LABELS[channel],
              value: formatNumber(n),
            })),
            ...(since ? [{ label: "Depuis", value: formatDateTime(since) }] : []),
          ]}
          rationale={shown(feedbacks.ids)}
          evidence={feedbacks.ids.slice(0, EVIDENCE_IN_POPOVER)}
        />
        {channels.map(([channel, n]) => (
          <span key={channel} className="inline-flex items-center gap-1">
            <ChannelBadge channel={channel} />
            <span className="tabular-nums">{formatNumber(n)}</span>
          </span>
        ))}
        {!first && (
          <>
            <span className="text-muted-foreground">dont</span>
            <MetricWithSource
              label="Retours qui confirment un sujet connu"
              value={formatNumber(feedbacks.confirming_known.length)}
              source="calcule"
              rationale={
                "Rattachés à un insight qui existait avant la période. " +
                (shown(feedbacks.confirming_known) ?? "")
              }
              evidence={feedbacks.confirming_known.slice(0, EVIDENCE_IN_POPOVER)}
            />
            <span>
              {feedbacks.confirming_known.length > 1 ? "confirment" : "confirme"} un sujet connu
            </span>
          </>
        )}
      </li>
    </RadarCard>
  );
}

/** Trends, ranking moves, accounts at risk and new feedbacks, as compact cards (SPEC §12.2). */
export function RadarSection({
  facts,
  weekly,
  mrr,
  since,
}: {
  facts: DigestFacts;
  weekly: Map<string, number[]>;
  mrr: Map<string, number>;
  since: string | null;
}) {
  const trends = facts.emerging.length + facts.new_insights.length > 0;
  const moves = facts.ranking.has_history && facts.ranking.moves.length > 0;
  const accounts = facts.accounts_at_risk.length > 0;
  const feedbacks = facts.feedbacks.total > 0;
  if (!trends && !moves && !accounts && !feedbacks) return null;
  return (
    <section aria-labelledby="ce-qui-bouge" className="flex flex-col gap-3">
      <SectionTitle id="ce-qui-bouge">Ce qui bouge</SectionTitle>
      <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
        {trends && (
          <TrendsCard
            emerging={facts.emerging}
            newInsights={facts.new_insights}
            weekly={weekly}
            first={facts.first}
          />
        )}
        {moves && <MovesCard moves={facts.ranking.moves} wide={!accounts} />}
        {accounts && <AccountsCard accounts={facts.accounts_at_risk} mrr={mrr} wide={!moves} />}
        {feedbacks && (
          <FeedbacksCard feedbacks={facts.feedbacks} since={since} first={facts.first} />
        )}
      </div>
    </section>
  );
}

/** Empty sections on one line instead of a title each (SPEC §12.2). */
export function QuietLine({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <p className="rounded-lg border border-dashed px-4 py-2.5 text-muted-foreground">
      Rien de neuf : {items.join(", ")}.
    </p>
  );
}
