import { after } from "next/server";
import { Newspaper } from "lucide-react";
import { EmptyState } from "@/components/shell/states";
import { RegenerateButton } from "@/components/digest/regenerate-button";
import { InboxSection, PulseBar, QuietLine, RadarSection } from "@/components/digest/sections";
import { ModelBadge, Pill } from "@/components/signal/badges";
import { getDb } from "@/lib/db/client";
import { getDemoNow } from "@/lib/demo-now";
import { digestLede, digestPulse, pendingDecisions, quietSections } from "@/lib/digest/content";
import { formatDateTime, formatRelative } from "@/lib/format";
import { getCustomersMrr, getDigest, getWeeklyTrends, markSeen } from "@/server/queries/digest";
import { listOpenAlerts } from "@/server/queries/shell";

// « Régénérer » runs one reasoning call from this page (~15 s).
export const maxDuration = 60;

/**
 * Digest (SPEC §12.2, ADR-033): the latest digest, ordered by decision. What waits for Léa
 * (open alerts, recommendations, pending decisions), then what moved, then the empty sections.
 */
export default async function DigestPage() {
  const db = getDb();
  const digest = await getDigest(db);
  // Every visit moves the start of the next digest's period (after the response is sent).
  after(() => markSeen(db, new Date()).catch((error) => console.error(error)));
  const now = getDemoNow();

  if (!digest) {
    return (
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
  const recommendations = digest.writing.recommandations;
  const trendIds = [
    ...facts.emerging.map((e) => e.insight_id),
    ...facts.new_insights.map((i) => i.insight_id),
  ];
  const [alerts, weekly, mrr] = await Promise.all([
    // Alerts open now, oldest first: the digest is read in the order things happened.
    listOpenAlerts(db).then((open) => [...open].reverse()),
    getWeeklyTrends(db, trendIds),
    getCustomersMrr(
      db,
      facts.accounts_at_risk.map((a) => a.customer_id),
    ),
  ]);
  const pulse = digestPulse(facts, alerts.length, recommendations.length);
  const inboxEmpty =
    alerts.length + recommendations.length + pendingDecisions(facts.pending).length === 0;

  return (
    <div className="@container mx-auto flex max-w-6xl flex-col gap-6 px-8 py-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-xl font-semibold tracking-tight">Bonjour Léa.</h2>
            <p className="text-[15px] leading-relaxed">{digestLede(pulse, facts.first)}</p>
          </div>
          <RegenerateButton />
        </div>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
          <span title={`${formatDateTime(digest.created_at)} (heure de Paris)`}>
            Généré {formatRelative(digest.created_at, now)}
          </span>
          <span aria-hidden>·</span>
          <span>
            {facts.first ? "premier digest" : `depuis le ${formatDateTime(digest.period_start)}`}
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
        <PulseBar pulse={pulse} />
      </header>

      <InboxSection alerts={alerts} recommendations={recommendations} pending={facts.pending} />
      <RadarSection
        facts={facts}
        weekly={weekly}
        mrr={mrr}
        since={facts.first ? null : digest.period_start}
      />
      <QuietLine items={quietSections(facts, inboxEmpty)} />
    </div>
  );
}
