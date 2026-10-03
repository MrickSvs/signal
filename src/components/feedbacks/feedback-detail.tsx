import { ArrowUpRight } from "lucide-react";
import { InsightChip } from "@/components/signal/chips";
import { ChannelBadge, HealthBadge, ModelBadge, PlanBadge, Pill } from "@/components/signal/badges";
import { explainItem, type WhyOptions } from "@/lib/feedbacks/why";
import {
  formatDate,
  formatDateTime,
  formatDaysUntil,
  formatEur,
  formatPercent,
  formatRelative,
} from "@/lib/format";
import {
  INSIGHT_STATUS_LABELS,
  ITEM_TYPE_LABELS,
  PRODUCT_AREA_LABELS,
  SEGMENT_LABELS,
  URGENCY_LABELS,
  languageLabel,
  notionPageUrl,
  sentimentLabel,
} from "@/lib/labels";
import type { FeedbackDetail as Detail } from "@/server/queries/feedbacks";
import { FeedbackSignals } from "./signals";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5 border-t px-6 py-4">
      <h3 className="text-[13px] font-semibold tracking-wide text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

/** Detail panel of a feedback (SPEC §12.3): verbatim, account, analysis, items and why. */
export function FeedbackDetail({
  feedback,
  now,
  why,
}: {
  feedback: Detail;
  now: Date;
  why: WhyOptions;
}) {
  const { customer, analysis } = feedback;
  return (
    <div className="flex flex-col pb-6">
      <header className="flex flex-col gap-2 px-6 pt-5 pr-14 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-lg font-semibold">{feedback.id}</span>
          <ChannelBadge channel={feedback.channel} />
          <span
            className="text-muted-foreground"
            title={`${formatDateTime(feedback.received_at)} (heure de Paris)`}
          >
            {formatRelative(feedback.received_at, now)}
          </span>
          {feedback.notion_page_id && (
            <a
              href={notionPageUrl(feedback.notion_page_id)}
              target="_blank"
              rel="noreferrer"
              className="ml-auto inline-flex items-center gap-0.5 font-medium text-signal underline-offset-4 hover:underline"
            >
              Notion
              <ArrowUpRight aria-hidden className="size-3.5" />
            </a>
          )}
        </div>
        {feedback.subject && <p className="font-semibold">{feedback.subject}</p>}
        {feedback.author_name && (
          <p className="text-muted-foreground">
            {feedback.author_name}
            {feedback.author_email ? ` · ${feedback.author_email}` : ""}
          </p>
        )}
      </header>

      <Section title="Verbatim">
        {/* Rendered as text, never as HTML: feedbacks are data (CLAUDE.md rule 3). */}
        <blockquote className="border-l-2 border-signal/40 pl-3 leading-relaxed break-words whitespace-pre-wrap">
          {feedback.raw_text}
        </blockquote>
        {feedback.truncated && (
          <p className="text-muted-foreground">
            Texte long : l&apos;analyse n&apos;a lu que le début et la fin (CL-06). Le verbatim
            ci-dessus est complet.
          </p>
        )}
        {feedback.nps_score !== null && (
          <p className="text-muted-foreground">Note NPS : {feedback.nps_score}/10</p>
        )}
      </Section>

      <Section title="Compte">
        {customer ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-semibold">{customer.name}</span>
              <span className="font-mono text-muted-foreground">{customer.id}</span>
              {customer.status === "prospect" ? (
                <Pill className="border-border text-muted-foreground">Prospect</Pill>
              ) : (
                <PlanBadge plan={customer.plan} />
              )}
              <HealthBadge health={customer.health} />
            </div>
            <dl className="grid grid-cols-3 gap-3">
              <Fact label="Segment">{SEGMENT_LABELS[customer.segment]}</Fact>
              <Fact label="MRR">{formatEur(customer.mrr_eur)}</Fact>
              <Fact label="Renouvellement">
                {customer.renewal_date ? (
                  <span title={formatDate(customer.renewal_date)}>
                    {formatDaysUntil(customer.renewal_date, now)}
                  </span>
                ) : (
                  "—"
                )}
              </Fact>
            </dl>
          </>
        ) : (
          <p className="text-muted-foreground">
            Compte non identifié : compté pour un compte, sans extrapolation, dans le Reach.
          </p>
        )}
      </Section>

      <Section title="Analyse du retour">
        {!analysis ? (
          <p className="text-muted-foreground">
            Pas encore analysé : le retour attend le prochain run.
          </p>
        ) : analysis.status === "failed" ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2">
              <FeedbackSignals flags={{ ...signalFlags(feedback), analysis_status: "failed" }} />
              <ModelBadge model={analysis.model} />
            </div>
            <p className="leading-relaxed text-muted-foreground">
              Le triage a échoué après les nouvelles tentatives (CL-11). Le retour sera repris par{" "}
              <code className="font-mono text-[13px]">pnpm pipeline:triage --retry-failed</code> ou
              le prochain run.
            </p>
            {analysis.error && (
              <p className="rounded-md bg-muted px-2.5 py-1.5 font-mono text-[13px] break-words">
                {analysis.error}
              </p>
            )}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <ModelBadge model={analysis.model} />
              <FeedbackSignals flags={signalFlags(feedback)} max={6} />
            </div>
            <dl className="grid grid-cols-4 gap-3">
              <Fact label="Sentiment">
                {analysis.sentiment !== null ? sentimentLabel(analysis.sentiment) : "—"}
              </Fact>
              <Fact label="Urgence">
                {analysis.urgency ? URGENCY_LABELS[analysis.urgency] : "—"}
              </Fact>
              <Fact label="Langue">
                {feedback.language ? languageLabel(feedback.language) : "—"}
              </Fact>
              <Fact label="Confiance">
                {analysis.confidence !== null ? formatPercent(analysis.confidence) : "—"}
              </Fact>
            </dl>
            {analysis.injection_suspected && (
              <p className="leading-relaxed text-muted-foreground">
                Le texte contient une instruction visant l&apos;IA. Signal l&apos;a classé sur son
                contenu réel et ne l&apos;a pas exécutée.
              </p>
            )}
          </>
        )}
      </Section>

      {feedback.items.length > 0 && (
        <Section title={feedback.items.length > 1 ? `${feedback.items.length} sujets` : "Sujet"}>
          <ol className="flex flex-col gap-3">
            {feedback.items.map((item) => (
              <li key={item.id} className="flex flex-col gap-2 rounded-lg border px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-muted-foreground">{item.id}</span>
                  <Pill className="border-border bg-muted text-foreground">
                    {ITEM_TYPE_LABELS[item.type]}
                  </Pill>
                  <span className="text-muted-foreground">
                    {PRODUCT_AREA_LABELS[item.product_area]}
                  </span>
                  {item.tags.length > 0 && (
                    <span className="text-muted-foreground">· {item.tags.join(", ")}</span>
                  )}
                </div>
                <p className="font-medium">{item.summary}</p>
                {item.insights.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    {item.insights.map((insight) => (
                      <span key={insight.id} className="flex min-w-0 items-center gap-1.5">
                        <InsightChip id={insight.id} title={insight.title} />
                        {insight.status !== "actif" && (
                          <Pill className="border-border text-muted-foreground">
                            {INSIGHT_STATUS_LABELS[insight.status]}
                          </Pill>
                        )}
                      </span>
                    ))}
                  </div>
                ) : item.watch ? (
                  <p className="text-muted-foreground">Sujet à surveiller</p>
                ) : null}
                <details className="group">
                  <summary className="cursor-pointer font-medium text-signal">
                    Pourquoi ce classement
                  </summary>
                  <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 leading-relaxed text-muted-foreground">
                    {explainItem(item, item.insights, why).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ol>
        </Section>
      )}
    </div>
  );
}

function signalFlags(feedback: Detail) {
  return {
    analysis_status: feedback.analysis?.status ?? null,
    injection_suspected: feedback.analysis?.injection_suspected ?? null,
    churn_signal: feedback.analysis?.churn_signal ?? null,
    existing_feature: feedback.items.some((i) => i.existing_feature),
    language: feedback.language,
    truncated: feedback.truncated,
  };
}
