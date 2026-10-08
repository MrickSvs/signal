import Link from "next/link";
import { ArrowLeft, Layers, Scale } from "lucide-react";
import { DraftBacklogButton } from "@/components/backlog/draft-button";
import { EmptyState } from "@/components/shell/states";
import { Section } from "@/components/digest/sections";
import { Sparkline } from "@/components/digest/sparkline";
import { TO_REVIEW_STYLE, accountsBreakdown } from "@/components/insights/insight-card";
import { ReviewActions } from "@/components/insights/review-actions";
import { ScoreBreakdown } from "@/components/insights/score-breakdown";
import { CHANNEL_ICONS, HealthBadge, Pill } from "@/components/signal/badges";
import { EvidenceChip, InsightChip } from "@/components/signal/chips";
import { loadContextPack } from "@/lib/context";
import { getDb } from "@/lib/db/client";
import { getDemoNow } from "@/lib/demo-now";
import { formatDate, formatDaysUntil, formatEur, formatNumber, formatRelative } from "@/lib/format";
import { feedbackIdsOfItems } from "@/lib/insights/list";
import {
  CHANNEL_LABELS,
  INSIGHT_STATUS_LABELS,
  MOSCOW_LABELS,
  PLAN_LABELS,
  PRODUCT_AREA_LABELS,
  SEGMENT_LABELS,
} from "@/lib/labels";
import { cn } from "@/lib/utils";
import { getUnsentBacklog } from "@/server/queries/backlog";
import { INSIGHT_ID } from "@/server/queries/evidence";
import { getInsightDetail, listMergeTargets, type DetailFeedback } from "@/server/queries/insights";

// « Rédiger le backlog » runs here (≈ 30 s: one drafting call and one estimation call).
export const maxDuration = 120;

const MAX_REQUEST_CHIPS = 4;

const STATUS_STYLES: Record<string, string> = { propose: TO_REVIEW_STYLE };

/** A feedback of the insight: summary first, then where it comes from (as in Retours, ADR-037). */
function FeedbackLine({
  feedback,
  insightId,
  now,
}: {
  feedback: DetailFeedback;
  insightId: string;
  now: Date;
}) {
  const ChannelIcon = CHANNEL_ICONS[feedback.channel];
  return (
    <li className="relative flex flex-col gap-1 px-4 py-2.5 hover:bg-muted/40">
      <Link
        href={`/retours?insight=${insightId}&retour=${feedback.id}`}
        className="line-clamp-2 leading-snug after:absolute after:inset-0 after:content-['']"
      >
        {feedback.summary ?? feedback.subject}
      </Link>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-muted-foreground">
        <span className="font-mono font-medium text-foreground">{feedback.id}</span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          <ChannelIcon aria-hidden className="size-3.5" />
          {CHANNEL_LABELS[feedback.channel]}
        </span>
        <span aria-hidden>·</span>
        <span title={formatDate(feedback.received_at)}>
          {formatRelative(feedback.received_at, now)}
        </span>
        <span aria-hidden>·</span>
        {feedback.customer ? (
          <span>
            <span className="text-foreground">{feedback.customer.name}</span>{" "}
            {feedback.is_prospect
              ? "(prospect)"
              : feedback.customer.plan && `(${PLAN_LABELS[feedback.customer.plan]})`}
          </span>
        ) : (
          <span>Compte non identifié</span>
        )}
      </p>
    </li>
  );
}

/** One key figure under the title; a link when it leads to its proof. */
function Figure({
  label,
  href,
  children,
}: {
  label: string;
  href?: string;
  children: React.ReactNode;
}) {
  const body = (
    <>
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className="text-lg leading-tight font-semibold tabular-nums">{children}</span>
    </>
  );
  const className = "-mr-px -mb-px flex min-w-0 flex-col gap-0.5 border-r border-b px-3 py-2";
  return href ? (
    <Link href={href} className={cn(className, "hover:bg-muted/60")}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}

/** One insight (SPEC §12.4): the problem, who has it, the proof, and its score. */
export default async function InsightPage({ params }: PageProps<"/insights/[id]">) {
  const { id } = await params;
  const db = getDb();
  const now = getDemoNow();
  const pack = await loadContextPack();
  const [insight, targets, unsent] = await Promise.all([
    INSIGHT_ID.test(id) ? getInsightDetail(db, id, { weighting: pack.weighting, now }) : null,
    listMergeTargets(db),
    getUnsentBacklog(db, INSIGHT_ID.test(id) ? [id] : []),
  ]);

  if (!insight) {
    return (
      <EmptyState icon={Layers} title="Insight introuvable">
        <p>
          L&apos;insight {id} n&apos;existe pas.{" "}
          <Link
            href="/insights"
            className="font-medium text-signal underline-offset-4 hover:underline"
          >
            Revenir aux insights
          </Link>
        </p>
      </EmptyState>
    );
  }

  const live = insight.status === "propose" || insight.status === "actif";
  const trend = insight.trendData;
  const plans = accountsBreakdown(insight.breakdown.plans);
  const segments = Object.entries(insight.breakdown.segments).toSorted((a, b) => b[1] - a[1]);
  const representativeIds = new Set(insight.representative.map((f) => f.id));
  const moscowFinal = insight.score?.overrides.find((o) => o.param === "moscow");
  const moscow =
    (moscowFinal && typeof moscowFinal.value === "string" && moscowFinal.value in MOSCOW_LABELS
      ? (moscowFinal.value as keyof typeof MOSCOW_LABELS)
      : null) ??
    insight.score?.moscow_reco ??
    null;

  return (
    <div className="@container mx-auto flex max-w-6xl flex-col gap-7 px-8 py-6">
      <Link
        href="/insights"
        className="inline-flex items-center gap-1 self-start font-medium text-signal underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        Tous les insights
      </Link>

      <header className="flex flex-col gap-3">
        <p className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <span className="font-mono font-semibold text-foreground">{insight.id}</span>
          <Pill className={STATUS_STYLES[insight.status] ?? "border-border text-muted-foreground"}>
            {INSIGHT_STATUS_LABELS[insight.status]}
          </Pill>
          {insight.product_area && <span>{PRODUCT_AREA_LABELS[insight.product_area]}</span>}
          {insight.origin === "manuel" && (
            <Pill className="border-border text-muted-foreground">Manuel</Pill>
          )}
          {insight.title_locked && (
            <span title="Formulation reformulée par le PO, conservée par les runs suivants">
              · formulation du PO
            </span>
          )}
          {!insight.ranked && live && <span>· signal faible, hors classement</span>}
        </p>
        <h2 className="text-xl leading-snug font-semibold tracking-tight">{insight.title}</h2>
        <p className="max-w-3xl leading-relaxed">{insight.problem_statement}</p>
        {insight.status === "fusionne" && insight.merged_into && (
          <p className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-muted/50 px-4 py-2.5">
            Fusionné dans <InsightChip id={insight.merged_into} /> : ses retours y sont désormais
            comptés.
          </p>
        )}
        {insight.status === "rejete" && (
          <p className="rounded-lg border bg-muted/50 px-4 py-2.5">
            Rejeté par le PO : hors classement. Il restera rejeté s&apos;il se reforme.
          </p>
        )}
        {insight.absorbed.length > 0 && (
          <p className="flex flex-wrap items-center gap-1.5 text-muted-foreground">
            A absorbé
            {insight.absorbed.map((a) => (
              <InsightChip key={a.id} id={a.id} title={a.title} />
            ))}
          </p>
        )}
        <div className="grid grid-cols-2 overflow-hidden rounded-lg border @xl:grid-cols-4">
          <Figure label="Rang" href={`/priorisation?insight=${insight.id}`}>
            {insight.score?.rank != null && insight.ranked ? (
              `#${insight.score.rank}`
            ) : (
              <span className="text-base font-normal text-muted-foreground">Hors classement</span>
            )}
          </Figure>
          <Figure label={moscowFinal ? "MoSCoW (ton choix)" : "MoSCoW (reco)"}>
            {moscow ? MOSCOW_LABELS[moscow] : "—"}
          </Figure>
          <Figure label="RICE">
            {insight.score ? formatNumber(Number(insight.score.rice), 2) : "—"}
          </Figure>
          <Figure label="Tendance, 7 jours">
            <span className="flex items-center gap-2">
              {formatNumber(trend.recent ?? 0)}
              {trend.weekly && trend.weekly.length > 1 && <Sparkline weekly={trend.weekly} />}
            </span>
          </Figure>
          <Figure label="Retours" href={`/retours?insight=${insight.id}`}>
            {formatNumber(insight.feedbacks.length)}
          </Figure>
          <Figure label="Comptes">{formatNumber(insight.accounts_count)}</Figure>
          <Figure label="MRR exposé">{formatEur(Number(insight.mrr_exposed))}</Figure>
          <Figure label="Renouvellements < 90 j">{formatNumber(insight.renewals_90d)}</Figure>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {live && insight.origin === "retours" && (
            <ReviewActions
              insight={insight}
              targets={targets}
              canAccept={insight.status === "propose"}
              unsent={unsent[insight.id]}
            />
          )}
          {live && <DraftBacklogButton insightId={insight.id} />}
        </div>
      </header>

      <Section title="Ce qu'ils demandent / Ce dont ils ont besoin">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-xl border p-4">
            <h4 className="text-[13px] font-medium text-muted-foreground uppercase">
              Ce qu&apos;ils demandent
            </h4>
            {insight.expressed.length === 0 ? (
              <p className="text-muted-foreground">
                Aucune solution exprimée : ils décrivent le problème.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {insight.expressed.map((r) => {
                  const ids = feedbackIdsOfItems(r.item_ids);
                  return (
                    <li key={r.solution} className="flex flex-col gap-1">
                      <p className="flex items-baseline justify-between gap-3">
                        <span>« {r.solution} »</span>
                        <span className="shrink-0 text-muted-foreground tabular-nums">
                          {formatNumber(r.frequency)} retour{r.frequency > 1 ? "s" : ""}
                        </span>
                      </p>
                      <span className="flex flex-wrap items-center gap-1">
                        {ids.slice(0, MAX_REQUEST_CHIPS).map((f) => (
                          <EvidenceChip key={f} id={f} />
                        ))}
                        {ids.length > MAX_REQUEST_CHIPS && (
                          <span className="text-muted-foreground">
                            +{ids.length - MAX_REQUEST_CHIPS}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="flex flex-col gap-2 rounded-xl border border-signal/30 bg-signal-soft/40 p-4">
            <h4 className="text-[13px] font-medium text-muted-foreground uppercase">
              Ce dont ils ont besoin
            </h4>
            <p className="text-base font-medium">{insight.title}</p>
            <p className="text-muted-foreground">
              Le problème commun à {formatNumber(insight.feedbacks.length)} retours de{" "}
              {formatNumber(insight.accounts_count)} comptes : c&apos;est lui que Signal regroupe et
              score, pas les solutions demandées.
            </p>
          </div>
        </div>
      </Section>

      <div className="grid grid-cols-1 gap-6 @2xl:grid-cols-2">
        <Section title="Qui est concerné">
          <dl className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <dt className="text-[13px] font-medium text-muted-foreground">Par plan</dt>
              <dd className="flex flex-wrap gap-x-4 gap-y-1">
                {plans.map((p) => (
                  <span key={p.label}>
                    {p.label} <span className="font-medium tabular-nums">{p.value}</span>
                  </span>
                ))}
              </dd>
            </div>
            {segments.length > 0 && (
              <div className="flex flex-col gap-1">
                <dt className="text-[13px] font-medium text-muted-foreground">Par segment</dt>
                <dd className="flex flex-wrap gap-x-4 gap-y-1">
                  {segments.map(([segment, n]) => (
                    <span key={segment}>
                      {SEGMENT_LABELS[segment as keyof typeof SEGMENT_LABELS] ?? "Sans compte"}{" "}
                      <span className="font-medium tabular-nums">{formatNumber(n)}</span>
                    </span>
                  ))}
                </dd>
              </div>
            )}
          </dl>
        </Section>
        <Section title="Canaux">
          <ul className="flex flex-col gap-1.5">
            {insight.channelCounts.map(([channel, n]) => {
              const Icon = CHANNEL_ICONS[channel];
              return (
                <li key={channel} className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5">
                    <Icon aria-hidden className="size-3.5 text-muted-foreground" />
                    {CHANNEL_LABELS[channel]}
                  </span>
                  <span className="tabular-nums">{formatNumber(n)}</span>
                </li>
              );
            })}
          </ul>
          {trend.weekly && trend.weekly.length > 1 && (
            <p className="text-[13px] text-muted-foreground">
              Croissance ×{formatNumber(trend.growth ?? 0, 2)} sur 7 jours
              {trend.is_emerging
                ? " : tendance émergente."
                : trend.is_new
                  ? " : sujet nouveau."
                  : "."}
            </p>
          )}
        </Section>
      </div>

      {insight.tensions.length > 0 && (
        <Section title="Tensions avec d'autres insights" count={insight.tensions.length}>
          <ul className="flex flex-col gap-2">
            {insight.tensions.map((t) => (
              <li key={t.other.id} className="flex flex-col gap-1.5 rounded-xl border p-4">
                <p className="flex flex-wrap items-center gap-2">
                  <Scale aria-hidden className="size-4 text-amber-600" />
                  En tension avec <InsightChip id={t.other.id} title={t.other.title} />
                </p>
                {t.segments.length > 0 && (
                  <ul className="flex flex-col gap-0.5">
                    {t.segments.map((s) => (
                      <li key={s.segment}>
                        <span className="font-medium">{s.segment}</span> : {s.position}
                      </li>
                    ))}
                  </ul>
                )}
                {t.rationale && <p className="text-muted-foreground">{t.rationale}</p>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Comptes concernés" count={insight.accounts.length}>
        {insight.accounts.length === 0 ? (
          <p className="text-muted-foreground">Aucun compte identifié.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-left">
              <thead className="bg-muted/50 text-[13px] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Compte</th>
                  <th className="px-3 py-2 font-medium">Plan</th>
                  <th className="px-3 py-2 text-right font-medium">MRR</th>
                  <th className="px-3 py-2 font-medium">Renouvellement</th>
                  <th className="px-3 py-2 font-medium">Santé</th>
                  <th className="px-3 py-2 font-medium">Retours</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {insight.accounts.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2 font-medium">{a.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {a.status === "prospect" ? "Prospect" : a.plan ? PLAN_LABELS[a.plan] : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {a.status === "prospect" ? "—" : formatEur(Number(a.mrr_eur))}
                    </td>
                    <td
                      className="px-3 py-2 tabular-nums"
                      title={a.renewal_date ? formatDate(a.renewal_date) : undefined}
                    >
                      {a.renewal_date ? formatDaysUntil(a.renewal_date, now) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <HealthBadge health={a.health} />
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {a.feedback_ids.slice(0, 3).map((f) => (
                          <EvidenceChip key={f} id={f} />
                        ))}
                        {a.feedback_ids.length > 3 && (
                          <span className="text-muted-foreground">
                            +{a.feedback_ids.length - 3}
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {insight.unidentified > 0 && (
          <p className="text-muted-foreground">
            Plus {formatNumber(insight.unidentified)} retour{insight.unidentified > 1 ? "s" : ""}{" "}
            sans compte identifiable, compté{insight.unidentified > 1 ? "s" : ""} sans
            extrapolation.
          </p>
        )}
      </Section>

      <Section title="Score">
        {insight.score ? (
          <ScoreBreakdown insightId={insight.id} score={insight.score} />
        ) : (
          <p className="text-muted-foreground">
            {live
              ? "Pas de score : un signal faible n'entre pas dans le classement."
              : "Hors classement."}
          </p>
        )}
      </Section>

      <Section title="Retours" count={insight.feedbacks.length}>
        {insight.representative.length > 0 && (
          <>
            <p className="text-[13px] font-medium text-muted-foreground">Représentatifs</p>
            <ul className="flex flex-col divide-y rounded-lg border">
              {insight.representative.map((f) => (
                <FeedbackLine key={f.id} feedback={f} insightId={insight.id} now={now} />
              ))}
            </ul>
            <p className="mt-2 text-[13px] font-medium text-muted-foreground">Les autres retours</p>
          </>
        )}
        <ul className="flex flex-col divide-y rounded-lg border">
          {insight.feedbacks
            .filter((f) => !representativeIds.has(f.id))
            .map((f) => (
              <FeedbackLine key={f.id} feedback={f} insightId={insight.id} now={now} />
            ))}
        </ul>
        <Link
          href={`/retours?insight=${insight.id}`}
          className="self-start font-medium text-signal underline-offset-4 hover:underline"
        >
          Filtrer l&apos;écran Retours sur {insight.id}
        </Link>
      </Section>
    </div>
  );
}
