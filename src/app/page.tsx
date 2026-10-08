import { after } from "next/server";
import {
  DigestBody,
  DigestGenerationProvider,
  FirstDigest,
  GenerationPanel,
} from "@/components/digest/generation";
import { RegenerateButton } from "@/components/digest/regenerate-button";
import { InboxSection, PulseBar, QuietLine, RadarSection } from "@/components/digest/sections";
import { ModelBadge, Pill } from "@/components/signal/badges";
import { getDb } from "@/lib/db/client";
import { getDemoNow } from "@/lib/demo-now";
import { digestLede, digestPulse, pendingDecisions, quietSections } from "@/lib/digest/content";
import { formatDateTime, formatRelative } from "@/lib/format";
import { getCustomersMrr, getDigest, getWeeklyTrends, markSeen } from "@/server/queries/digest";
import { listOpenAlerts } from "@/server/queries/shell";

// Read from the base on every request, never prerendered at build time (no database there).
export const dynamic = "force-dynamic";

/**
 * Digest (SPEC §12.2, ADR-033): the latest digest, ordered by decision. What waits for Léa
 * (open alerts, recommendations, pending decisions), then what moved, then the empty sections.
 */
export default async function DigestPage() {
  const db = getDb();
  const digest = await getDigest(db);
  const now = getDemoNow();

  // The same provider on both branches: a first generation flows into the digest it wrote.
  // An empty page is not a visit: Léa has read nothing, so the first digest still covers everything.
  if (!digest) {
    return (
      <DigestGenerationProvider first>
        <FirstDigest />
      </DigestGenerationProvider>
    );
  }
  // Every visit of a digest moves the start of the next one's period (after the response is sent).
  after(() => markSeen(db, new Date()).catch((error) => console.error(error)));

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
  // Answered recommendations stay listed (struck through) but no longer count as to do (ADR-036).
  const openRecommendations = recommendations.length - Object.keys(digest.answered).length;
  const pulse = digestPulse(facts, alerts.length, openRecommendations);
  const inboxEmpty =
    alerts.length + recommendations.length + pendingDecisions(facts.pending).length === 0;

  return (
    <DigestGenerationProvider first={false}>
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

        <GenerationPanel />
        <DigestBody>
          <InboxSection
            digestId={digest.id}
            alerts={alerts}
            recommendations={recommendations}
            answered={digest.answered}
            pending={facts.pending}
          />
          <RadarSection
            facts={facts}
            weekly={weekly}
            mrr={mrr}
            since={facts.first ? null : digest.period_start}
          />
          <QuietLine items={quietSections(facts, inboxEmpty)} />
        </DigestBody>
      </div>
    </DigestGenerationProvider>
  );
}
