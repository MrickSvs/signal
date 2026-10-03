import Link from "next/link";
import { after } from "next/server";
import { ArrowLeft, Newspaper } from "lucide-react";
import { EmptyState } from "@/components/shell/states";
import { RegenerateButton } from "@/components/digest/regenerate-button";
import { DigestMarkdown } from "@/components/digest/id-text";
import {
  AccountsSection,
  AlertsSection,
  FeedbacksSection,
  MovesSection,
  PendingSection,
  RecommendationsSection,
  TrendsSection,
  type DigestAlert,
} from "@/components/digest/sections";
import { ModelBadge, Pill } from "@/components/signal/badges";
import { getDb } from "@/lib/db/client";
import { getDemoNow } from "@/lib/demo-now";
import { formatDateTime, formatRelative } from "@/lib/format";
import { NO_HISTORY } from "@/pipeline/nodes/digest";
import {
  getCustomersMrr,
  getDigest,
  getWeeklyTrends,
  listOpenAlertDossiers,
  markSeen,
} from "@/server/queries/digest";

// « Régénérer » runs one reasoning call from this page (~15 s).
export const maxDuration = 60;

/** Digest (SPEC §12.2): what changed since Léa's last visit, in the fixed order. */
export default async function DigestPage({ searchParams }: PageProps<"/">) {
  const { digest: askedId } = await searchParams;
  const db = getDb();
  const digest = await getDigest(db, typeof askedId === "string" ? askedId : undefined);
  // Every visit moves the start of the next digest's period (after the response is sent).
  after(() => markSeen(db, new Date()).catch((error) => console.error(error)));
  const now = getDemoNow();

  if (!digest) {
    return askedId ? (
      <EmptyState icon={Newspaper} title="Digest introuvable">
        <p>
          Ce digest n&apos;existe pas ou plus.{" "}
          <Link href="/" className="font-medium text-signal underline-offset-4 hover:underline">
            Voir le dernier digest
          </Link>
        </p>
      </EmptyState>
    ) : (
      <EmptyState icon={Newspaper} title="Pas encore de digest">
        <p className="mb-4">
          Le premier digest s&apos;écrit après le premier run du pipeline, chaque nuit ou à la
          demande.
        </p>
        <div className="flex justify-center">
          <RegenerateButton label="Générer le digest" />
        </div>
      </EmptyState>
    );
  }

  const { facts } = digest;
  const trendIds = [
    ...facts.emerging.map((e) => e.insight_id),
    ...facts.new_insights.map((i) => i.insight_id),
  ];
  const [liveAlerts, weekly, mrr] = await Promise.all([
    // The latest digest shows the alerts open now, with the dossiers written since; an older one
    // shows what it said at the time.
    digest.isLatest ? listOpenAlertDossiers(db) : null,
    getWeeklyTrends(db, trendIds),
    getCustomersMrr(
      db,
      facts.accounts_at_risk.map((a) => a.customer_id),
    ),
  ]);
  const alerts: DigestAlert[] = liveAlerts
    ? liveAlerts.map((a) => ({ ...a, dossier: a.dossier_markdown }))
    : facts.alerts;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 px-8 py-6">
      {!digest.isLatest && (
        <p className="rounded-lg border bg-muted/50 px-4 py-2.5">
          Tu consultes un ancien digest.{" "}
          <Link href="/" className="font-medium text-signal underline-offset-4 hover:underline">
            Revenir au dernier
          </Link>
        </p>
      )}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-xl font-semibold tracking-tight">
            Bonjour Léa. Voici ce qui a changé depuis ta dernière visite.
          </h2>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
            <span title={`${formatDateTime(digest.created_at)} (heure de Paris)`}>
              Généré {formatRelative(digest.created_at, now)}
            </span>
            <span aria-hidden>·</span>
            <span>
              {facts.first
                ? "premier digest"
                : `période depuis le ${formatDateTime(digest.period_start)}`}
            </span>
            {digest.model ? (
              <ModelBadge model={digest.model} />
            ) : (
              <Pill
                className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
                title={digest.error ?? undefined}
              >
                Rendu brut des faits
              </Pill>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {digest.previousId && (
            <Link
              href={`/?digest=${digest.previousId}`}
              className="inline-flex items-center gap-1 font-medium text-signal underline-offset-4 hover:underline"
            >
              <ArrowLeft aria-hidden className="size-4" />
              Digest précédent
            </Link>
          )}
          {digest.isLatest && <RegenerateButton />}
        </div>
      </header>

      <AlertsSection alerts={alerts} />
      <FeedbacksSection
        feedbacks={facts.feedbacks}
        since={facts.first ? null : digest.period_start}
        first={facts.first}
      />
      <TrendsSection
        emerging={facts.emerging}
        newInsights={facts.new_insights}
        weekly={weekly}
        first={facts.first}
      />
      <AccountsSection accounts={facts.accounts_at_risk} mrr={mrr} />
      {facts.ranking.has_history ? (
        <MovesSection moves={facts.ranking.moves} />
      ) : (
        // CL-18: no « Mouvements » section on a first run.
        <p className="text-muted-foreground">{NO_HISTORY}</p>
      )}
      <PendingSection pending={facts.pending} />
      <RecommendationsSection recommendations={digest.writing.recommandations} />

      {digest.markdown && (
        <details className="group rounded-lg border px-4 py-3">
          <summary className="cursor-pointer font-medium text-muted-foreground group-open:mb-3">
            Texte rédigé par Signal
          </summary>
          <DigestMarkdown markdown={digest.markdown} />
        </details>
      )}
    </div>
  );
}
