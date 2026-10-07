"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import {
  loadBacklogItemPreview,
  loadFeedbackEvidence,
  loadInsightPreview,
} from "@/server/actions/evidence";
import { formatDate, formatEur, formatNumber, formatRelative } from "@/lib/format";
import {
  BACKLOG_STATUS_LABELS,
  INSIGHT_STATUS_LABELS,
  PRODUCT_AREA_LABELS,
  notionPageUrl,
} from "@/lib/labels";
import {
  BacklogKindBadge,
  ChannelBadge,
  HealthBadge,
  PlanBadge,
  Pill,
  kindFromBacklogId,
} from "./badges";
import { IdPreview } from "./id-preview";

function PreviewLinks({ links }: { links: { href: string; label: string; external?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-t pt-2.5">
      {links.map((link) =>
        link.external ? (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 font-medium text-signal underline-offset-4 hover:underline"
          >
            {link.label}
            <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        ) : (
          <Link
            key={link.href}
            href={link.href}
            className="font-medium text-signal underline-offset-4 hover:underline"
          >
            {link.label}
          </Link>
        ),
      )}
    </div>
  );
}

/** « R-042 » → verbatim, channel, account, plan, date and links (SPEC §12.1, P2). */
export function EvidenceChip({ id }: { id: string }) {
  return (
    <IdPreview
      id={id}
      load={loadFeedbackEvidence}
      contentClassName="w-[28rem]"
      render={(feedback) => (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono font-semibold">{feedback.id}</span>
            <ChannelBadge channel={feedback.channel} />
            <span className="text-muted-foreground" title={formatDate(feedback.received_at)}>
              {formatRelative(feedback.received_at, feedback.now)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {feedback.customer ? (
              <>
                <span className="font-medium">{feedback.customer.name}</span>
                {feedback.customer.status === "prospect" ? (
                  <Pill className="border-border text-muted-foreground">Prospect</Pill>
                ) : (
                  <PlanBadge plan={feedback.customer.plan} />
                )}
                <HealthBadge health={feedback.customer.health} />
              </>
            ) : (
              <span className="text-muted-foreground">Compte non identifié</span>
            )}
            {feedback.author_name && (
              <span className="text-muted-foreground">· {feedback.author_name}</span>
            )}
          </div>
          {feedback.subject && <p className="font-medium">{feedback.subject}</p>}
          {/* Rendered as text, never as HTML: feedbacks are data (CLAUDE.md rule 3). */}
          <blockquote className="max-h-64 overflow-y-auto border-l-2 border-signal/40 pl-3 leading-relaxed whitespace-pre-wrap">
            {feedback.raw_text}
          </blockquote>
          {feedback.truncated && (
            <p className="text-muted-foreground">Texte tronqué à l&apos;ingestion.</p>
          )}
          <PreviewLinks
            links={[{ href: `/retours?retour=${feedback.id}`, label: "Ouvrir le retour" }]}
          />
        </>
      )}
    />
  );
}

/** « I-07 » → problem, status, accounts, exposed MRR, rank. */
export function InsightChip({ id, title }: { id: string; title?: string | null }) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
      <IdPreview
        id={id}
        load={loadInsightPreview}
        render={(insight) => (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono font-semibold">{insight.id}</span>
              <Pill className="border-border text-muted-foreground">
                {INSIGHT_STATUS_LABELS[insight.status]}
              </Pill>
              {insight.origin === "manuel" && (
                <Pill className="border-border text-muted-foreground">Manuel</Pill>
              )}
              {insight.product_area && (
                <span className="text-muted-foreground">
                  {PRODUCT_AREA_LABELS[insight.product_area]}
                </span>
              )}
            </div>
            <p className="font-medium">{insight.title}</p>
            <p className="leading-relaxed text-muted-foreground">{insight.problem_statement}</p>
            <dl className="grid grid-cols-3 gap-2">
              <PreviewStat label="Comptes" value={formatNumber(insight.accounts_count)} />
              <PreviewStat label="MRR exposé" value={formatEur(insight.mrr_exposed)} />
              <PreviewStat
                label="Rang"
                value={
                  insight.score?.rank != null && insight.ranked
                    ? `${insight.score.rank}${insight.score.moscow_reco ? ` · ${insight.score.moscow_reco.toUpperCase()}` : ""}`
                    : "non classé"
                }
              />
            </dl>
            {insight.merged_into && (
              <p className="text-muted-foreground">Fusionné dans {insight.merged_into}.</p>
            )}
            <PreviewLinks
              links={[{ href: `/insights/${insight.id}`, label: "Ouvrir l'insight" }]}
            />
          </>
        )}
      />
      {title && <span className="truncate">{title}</span>}
    </span>
  );
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted px-2 py-1.5">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** « US-012 » / « BUG-003 » / « TT-004 » with a type badge → summary of the backlog item. */
export function BacklogItemChip({
  id,
  title,
  bare = false,
}: {
  id: string;
  title?: string | null;
  /** Without the kind badge, where the id sits among other ids (the preview still shows it). */
  bare?: boolean;
}) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5">
      {!bare && <BacklogKindBadge kind={kindFromBacklogId(id)} />}
      <IdPreview
        id={id}
        load={loadBacklogItemPreview}
        render={(item) => (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-mono font-semibold">{item.id}</span>
              <BacklogKindBadge kind={item.kind} />
              <Pill className="border-border text-muted-foreground">
                {BACKLOG_STATUS_LABELS[item.status]}
              </Pill>
              {item.points != null && (
                <span className="text-muted-foreground">{item.points} points</span>
              )}
            </div>
            <p className="font-medium">{item.title}</p>
            {item.kind === "story" && item.want && (
              <p className="leading-relaxed text-muted-foreground">
                En tant que {item.persona}, je veux {item.want}
                {item.value ? `, afin de ${item.value}` : ""}.
              </p>
            )}
            {item.kind === "bug" && item.severity && (
              <p className="text-muted-foreground">Sévérité : {item.severity}</p>
            )}
            {item.kind === "tache" && item.objective && (
              <p className="leading-relaxed text-muted-foreground">{item.objective}</p>
            )}
            {item.evidence.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-muted-foreground">Preuves :</span>
                {item.evidence.slice(0, 6).map((evidenceId) => (
                  <EvidenceChip key={evidenceId} id={evidenceId} />
                ))}
                {item.evidence.length > 6 && (
                  <span className="text-muted-foreground">+{item.evidence.length - 6}</span>
                )}
              </div>
            )}
            <PreviewLinks
              links={[
                { href: `/backlog?element=${item.id}`, label: "Ouvrir dans le backlog" },
                ...(item.insight_id
                  ? [{ href: `/insights/${item.insight_id}`, label: item.insight_id }]
                  : []),
                ...(item.notion_page_id
                  ? [{ href: notionPageUrl(item.notion_page_id), label: "Notion", external: true }]
                  : []),
              ]}
            />
          </>
        )}
      />
      {title && <span className="truncate">{title}</span>}
    </span>
  );
}
