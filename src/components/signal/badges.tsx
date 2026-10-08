import {
  Bot,
  Bug,
  CheckSquare,
  FileText,
  Gauge,
  Hash,
  Mail,
  MessageSquare,
  Phone,
  ScrollText,
  Ticket,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Database } from "@/lib/db/types";
import {
  BACKLOG_KIND_LABELS,
  CHANNEL_LABELS,
  HEALTH_LABELS,
  PLAN_LABELS,
  modelFamily,
  type ModelFamily,
} from "@/lib/labels";

// Plain, server-renderable badges (no hooks): usable from Server and Client Components alike.

type Enums = Database["public"]["Enums"];

export function Pill({
  className,
  children,
  title,
}: {
  className?: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[13px] leading-none font-medium whitespace-nowrap [&>svg]:size-3.5 [&>svg]:shrink-0",
        className,
      )}
    >
      {children}
    </span>
  );
}

export const CHANNEL_ICONS: Record<Enums["feedback_channel"], LucideIcon> = {
  email_client: Mail,
  ticket_support: Ticket,
  commentaire_in_app: MessageSquare,
  nps: Gauge,
  note_csm: Phone,
  note_sales: FileText,
  slack_interne: Hash,
};

export function ChannelBadge({ channel }: { channel: Enums["feedback_channel"] }) {
  const Icon = CHANNEL_ICONS[channel];
  return (
    <Pill className="border-border bg-background text-muted-foreground">
      <Icon aria-hidden />
      {CHANNEL_LABELS[channel]}
    </Pill>
  );
}

const PLAN_STYLES: Record<Enums["customer_plan"], string> = {
  free: "border-border bg-background text-muted-foreground",
  pro: "border-border bg-muted text-foreground",
  business:
    "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
  enterprise:
    "border-violet-200 bg-violet-50 text-violet-800 dark:border-violet-900 dark:bg-violet-950 dark:text-violet-200",
};

export function PlanBadge({ plan }: { plan: Enums["customer_plan"] | null }) {
  if (!plan) return null;
  return <Pill className={PLAN_STYLES[plan]}>{PLAN_LABELS[plan]}</Pill>;
}

const HEALTH_DOTS: Record<Enums["customer_health"], string> = {
  vert: "bg-emerald-500",
  orange: "bg-amber-500",
  rouge: "bg-red-500",
};

export function HealthBadge({ health }: { health: Enums["customer_health"] | null }) {
  if (!health) return null;
  return (
    <Pill className="border-border bg-background text-foreground">
      <span aria-hidden className={cn("size-2 rounded-full", HEALTH_DOTS[health])} />
      {HEALTH_LABELS[health]}
    </Pill>
  );
}

const MODEL_STYLES: Record<ModelFamily, string> = {
  Haiku: "border-border bg-background text-muted-foreground",
  Sonnet: "border-border bg-muted text-foreground",
  Opus: "border-foreground/20 bg-foreground text-background",
};

/** Marks what a model produced (SPEC §12.1); the full model id is in the tooltip. */
export function ModelBadge({ model }: { model: string }) {
  const family = modelFamily(model);
  return (
    <Pill
      title={`Produit par ${model}`}
      className={family ? MODEL_STYLES[family] : "border-border text-muted-foreground"}
    >
      <Bot aria-hidden />
      {family ?? model}
    </Pill>
  );
}

const KIND_ICONS: Record<Enums["backlog_kind"], LucideIcon> = {
  story: ScrollText,
  bug: Bug,
  tache: CheckSquare,
};

// Neutral: the icon tells the kind apart; color is kept for meaning (tones.ts, ADR-039).
const KIND_STYLES: Record<Enums["backlog_kind"], string> = {
  story: "border-border bg-background text-foreground",
  bug: "border-border bg-background text-foreground",
  tache: "border-border bg-background text-foreground",
};

export function BacklogKindBadge({ kind }: { kind: Enums["backlog_kind"] }) {
  const Icon = KIND_ICONS[kind];
  return (
    <Pill className={KIND_STYLES[kind]}>
      <Icon aria-hidden />
      {BACKLOG_KIND_LABELS[kind]}
    </Pill>
  );
}

/** Backlog kind from a readable id: US- story, BUG- bug, TT- task. */
export function kindFromBacklogId(id: string): Enums["backlog_kind"] {
  if (id.startsWith("BUG-")) return "bug";
  if (id.startsWith("TT-")) return "tache";
  return "story";
}
