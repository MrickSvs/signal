import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUp, MessageSquare, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChannelBadge, HealthBadge, Pill, PlanBadge } from "@/components/signal/badges";
import { EvidenceChip, InsightChip } from "@/components/signal/chips";
import { MetricWithSource } from "@/components/signal/metric-with-source";
import type { Database } from "@/lib/db/types";
import { pendingDecisions, type Recommendation } from "@/lib/digest/content";
import { formatDateTime, formatEur, formatNumber } from "@/lib/format";
import { ALERT_KIND_LABELS, CHANNEL_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { DigestFacts } from "@/pipeline/nodes/digest";
import { DigestMarkdown, IdText } from "./id-text";
import { Sparkline } from "./sparkline";

type Enums = Database["public"]["Enums"];

const MAX_CHIPS = 3;
const MAX_NEW_INSIGHTS = 6;
const MAX_PENDING_CHIPS = 8;

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

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="text-muted-foreground">{children}</p>;
}

function Chips({ ids, max = MAX_CHIPS }: { ids: readonly string[]; max?: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {ids.slice(0, max).map((id) => (
        <EvidenceChip key={id} id={id} />
      ))}
      {ids.length > max && <span className="text-muted-foreground">+{ids.length - max}</span>}
    </span>
  );
}

// 1. Open alerts ------------------------------------------------------------------------------

export type DigestAlert = {
  id: string;
  kind: Enums["alert_kind"];
  insight_id: string | null;
  insight_title: string | null;
  feedback_ids: string[];
  dossier_status: Enums["dossier_status"] | null;
  dossier: string | null;
};

const DOSSIER_PENDING: Record<Enums["dossier_status"], string> = {
  en_cours: "Dossier en cours de rédaction.",
  pret: "Dossier prêt.",
  echec: "Dossier indisponible : l'enquête a échoué.",
};

export function AlertsSection({ alerts }: { alerts: DigestAlert[] }) {
  if (alerts.length === 0) {
    return (
      <Section title="Alertes ouvertes">
        <Muted>Aucune alerte ouverte.</Muted>
      </Section>
    );
  }
  return (
    <Section title="Alertes ouvertes" count={alerts.length}>
      <ul className="flex flex-col gap-2">
        {alerts.map((alert) => (
          <li
            key={alert.id}
            className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/40"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="flex items-center gap-1.5 font-semibold">
                <TriangleAlert aria-hidden className="size-4 text-amber-600" />
                {ALERT_KIND_LABELS[alert.kind]}
              </span>
              {alert.insight_id && (
                <InsightChip id={alert.insight_id} title={alert.insight_title} />
              )}
              <span className="ml-auto">
                <Chips ids={alert.feedback_ids} />
              </span>
            </div>
            {alert.dossier ? (
              <div className="rounded-md bg-background px-3 py-2.5">
                <DigestMarkdown markdown={alert.dossier} />
              </div>
            ) : (
              <Muted>
                {alert.dossier_status
                  ? DOSSIER_PENDING[alert.dossier_status]
                  : "Pas encore de dossier."}
              </Muted>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

// 2. New feedbacks ----------------------------------------------------------------------------

const EVIDENCE_IN_POPOVER = 24;

export function FeedbacksSection({
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
    <Section title="Nouveaux retours">
      {feedbacks.total === 0 ? (
        <Muted>Aucun nouveau retour sur la période.</Muted>
      ) : (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 leading-relaxed">
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
          <span className="text-muted-foreground">:</span>
          {channels.map(([channel, n]) => (
            <span key={channel} className="inline-flex items-center gap-1">
              <ChannelBadge channel={channel} />
              <span className="tabular-nums">{formatNumber(n)}</span>
            </span>
          ))}
          {!first && (
            <>
              <span className="text-muted-foreground">— dont</span>
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
                {feedbacks.confirming_known.length > 1 ? "confirment" : "confirme"} un sujet connu.
              </span>
            </>
          )}
        </p>
      )}
    </Section>
  );
}

// 3. Emerging trends and new topics -----------------------------------------------------------

function TrendRow({
  insightId,
  title,
  weekly,
  children,
}: {
  insightId: string;
  title: string;
  weekly: number[] | undefined;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-4 px-4 py-2.5">
      <span className="w-24 shrink-0">
        {weekly ? <Sparkline weekly={weekly} /> : <span className="text-muted-foreground">—</span>}
      </span>
      <span className="min-w-0 flex-1">
        <InsightChip id={insightId} title={title} />
      </span>
      <span className="flex shrink-0 items-center gap-2">{children}</span>
    </li>
  );
}

export function TrendsSection({
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
  return (
    <Section title="Tendances émergentes et sujets nouveaux">
      {emerging.length === 0 && fresh.length === 0 ? (
        <Muted>Aucune tendance émergente ni nouveau sujet.</Muted>
      ) : (
        <ul className="divide-y rounded-lg border">
          {[...emerging]
            .sort((a, b) => b.recent - a.recent || b.growth - a.growth)
            .map((e) => (
              <TrendRow
                key={e.insight_id}
                insightId={e.insight_id}
                title={e.title}
                weekly={weekly.get(e.insight_id)}
              >
                <Pill className="border-signal/30 bg-signal-soft text-signal">Émergent</Pill>
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
                />
              </TrendRow>
            ))}
          {shownFresh.map((i) => (
            <TrendRow
              key={i.insight_id}
              insightId={i.insight_id}
              title={i.title}
              weekly={weekly.get(i.insight_id)}
            >
              <Pill className="border-border text-muted-foreground">
                {i.ranked ? "Nouveau · classé" : "Nouveau · signal faible"}
              </Pill>
            </TrendRow>
          ))}
          {fresh.length > shownFresh.length && (
            <li className="px-4 py-2.5">
              <Link
                href="/insights?statut=propose"
                className="font-medium text-signal underline-offset-4 hover:underline"
              >
                {first ? "Tous les sujets du premier run" : "Les autres sujets nouveaux"} (
                {formatNumber(fresh.length - shownFresh.length)} de plus) dans l&apos;écran Insights
              </Link>
            </li>
          )}
        </ul>
      )}
      <p className="text-[13px] text-muted-foreground">
        Courbes : retours par semaine sur 6 semaines, le dernier point couvre les 7 derniers jours.
      </p>
    </Section>
  );
}

// 4. Accounts at risk -------------------------------------------------------------------------

export function AccountsSection({
  accounts,
  mrr,
}: {
  accounts: DigestFacts["accounts_at_risk"];
  mrr: Map<string, number>;
}) {
  return (
    <Section title="Comptes à risque" count={accounts.length}>
      {accounts.length === 0 ? (
        <Muted>Aucun compte en renouvellement proche avec un signal négatif.</Muted>
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-left">
            <thead className="bg-muted/50 text-[13px] text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Compte</th>
                <th className="px-3 py-2 font-medium">MRR</th>
                <th className="px-3 py-2 font-medium">Renouvellement</th>
                <th className="px-3 py-2 font-medium">Signal négatif</th>
                <th className="px-3 py-2 font-medium">Insights liés</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {accounts.map((a) => {
                const value = mrr.get(a.customer_id);
                return (
                  <tr key={a.customer_id} className="align-top">
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-medium">{a.name}</span>
                        <PlanBadge plan={a.plan as Enums["customer_plan"] | null} />
                      </div>
                      <span className="font-mono text-[13px] text-muted-foreground">
                        {a.customer_id}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      {value === undefined ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
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
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">J+{a.renewal_in_days}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-col items-start gap-1.5">
                        <HealthBadge health={a.health as Enums["customer_health"] | null} />
                        {a.churn_feedback_ids.length > 0 && (
                          <span className="flex flex-wrap items-center gap-1">
                            <span className="text-muted-foreground">Churn</span>
                            <Chips ids={a.churn_feedback_ids} />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {a.insight_ids.length === 0 ? (
                        <span className="text-muted-foreground">Aucun</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {a.insight_ids.map((id) => (
                            <InsightChip key={id} id={id} />
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

// 5. Rank moves -------------------------------------------------------------------------------

export function MovesSection({ moves }: { moves: DigestFacts["ranking"]["moves"] }) {
  return (
    <Section title="Mouvements dans le classement" count={moves.length}>
      {moves.length === 0 ? (
        <Muted>Aucun mouvement depuis la version précédente.</Muted>
      ) : (
        <ul className="divide-y rounded-lg border">
          {moves.map((m) => {
            const up = m.from !== null && m.to !== null && m.to < m.from;
            const Icon = m.to === null ? ArrowDown : m.from === null || up ? ArrowUp : ArrowDown;
            return (
              <li key={m.insight_id} className="flex items-center gap-3 px-4 py-2.5">
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
                <span className="shrink-0 tabular-nums">
                  {m.from === null
                    ? `entre au rang ${m.to}`
                    : m.to === null
                      ? `sort du classement (était ${m.from})`
                      : `rang ${m.from} → ${m.to}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

// 6. Pending decisions ------------------------------------------------------------------------

function PendingRow({
  label,
  href,
  action,
  children,
}: {
  label: string;
  href: string;
  action: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-4 px-4 py-2.5">
      <span className="w-56 shrink-0 font-medium">{label}</span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{children}</span>
      <Link
        href={href}
        className="inline-flex shrink-0 items-center gap-1 font-medium text-signal underline-offset-4 hover:underline"
      >
        {action}
        <ArrowRight aria-hidden className="size-3.5" />
      </Link>
    </li>
  );
}

function More({ total, max }: { total: number; max: number }) {
  return total > max ? <span className="text-muted-foreground">+{total - max}</span> : null;
}

export function PendingSection({ pending }: { pending: DigestFacts["pending"] }) {
  const rows = pendingDecisions(pending);
  return (
    <Section title="Décisions en attente">
      {rows.length === 0 ? (
        <Muted>Rien à trancher.</Muted>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map((row) => (
            <PendingRow key={row.key} label={row.label} href={row.href} action={row.action}>
              {row.relation ? (
                <>
                  <InsightChip id={row.relation.left} />
                  <span>{row.relation.verb}</span>
                  <InsightChip id={row.relation.right} />
                </>
              ) : (
                <>
                  <IdText text={row.ids.slice(0, MAX_PENDING_CHIPS).join(" ")} />
                  <More total={row.ids.length} max={MAX_PENDING_CHIPS} />
                  {row.param && (
                    <span className="text-muted-foreground">paramètre {row.param}</span>
                  )}
                </>
              )}
            </PendingRow>
          ))}
        </ul>
      )}
    </Section>
  );
}

// 7. Recommendations --------------------------------------------------------------------------

const CONFIDENCE_STYLES: Record<Recommendation["confiance"], string> = {
  haute: "border-signal/30 bg-signal-soft text-signal",
  moyenne: "border-border bg-muted text-foreground",
  basse: "border-border text-muted-foreground",
};

export function RecommendationsSection({ recommendations }: { recommendations: Recommendation[] }) {
  return (
    <Section title="Recommandations de Signal">
      {recommendations.length === 0 ? (
        <Muted>Pas de recommandation dans ce digest.</Muted>
      ) : (
        <ol className="flex flex-col gap-3">
          {recommendations.map((r, index) => (
            <li key={index} className="flex gap-4 rounded-lg border p-4">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-signal-soft font-semibold text-signal tabular-nums">
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <p className="leading-snug font-semibold">
                    <IdText text={r.titre} />
                  </p>
                  <Pill className={CONFIDENCE_STYLES[r.confiance]}>Confiance {r.confiance}</Pill>
                </div>
                {r.justification && (
                  <p className="leading-relaxed text-muted-foreground">
                    <IdText text={r.justification} />
                  </p>
                )}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <span className="flex flex-wrap items-center gap-1">
                    <span className="text-muted-foreground">Preuves :</span>
                    <IdText text={r.preuves.join(" ")} />
                  </span>
                  <Button
                    variant="outline"
                    disabled
                    title="Le chat avec Signal arrive à l'étape 4.2."
                  >
                    <MessageSquare aria-hidden />
                    En parler à Signal
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}
