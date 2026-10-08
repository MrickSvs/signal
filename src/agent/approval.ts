// Validation by the PO (SPEC §10.6): the tools that write a decision or send to Notion
// pause on an approval card (human-in-the-loop middleware of LangChain v1); the run resumes from
// the checkpointer with Léa's choice (approve, edit, reject) through a Command. Pure helpers here;
// the resume itself is runTurn's.
import {
  AIMessage,
  ToolMessage,
  type BaseMessage,
  type DecisionType,
  type HITLRequest,
  type HITLResponse,
  type InterruptOnConfig,
} from "langchain";
import { z } from "zod";
import type { Weighting } from "@/lib/context";
import type { Db } from "@/lib/db/create";
import { checkDecision, describeDecision } from "@/lib/decisions/apply-decision";
import { previewPush, PushTargetError, resolvePushIds } from "@/services/notion/push-backlog";

/** Tools that never run without Léa's explicit approval. */
export const APPROVAL_TOOLS = ["apply_decision", "push_to_notion"] as const;

/**
 * Configuration of the human-in-the-loop middleware. apply_decision pauses only on a proposal
 * that passes the checks: an invalid one runs straight away and the tool, running the same check,
 * refuses it without writing (CL-23) — Léa never sees a card that cannot be applied.
 */
export function approvalConfig(weighting: Weighting): Record<string, InterruptOnConfig> {
  return {
    apply_decision: {
      allowedDecisions: ["approve", "edit", "reject"],
      description: (toolCall) => {
        const checked = checkDecision(toolCall.args, weighting);
        return checked.ok ? describeDecision(checked.request) : "Décision à valider";
      },
      when: (request) => checkDecision(request.toolCall.args, weighting).ok,
    },
    // An external write, sent as is or not at all (SPEC §11.2): the card shows each page.
    push_to_notion: {
      allowedDecisions: ["approve", "reject"],
      description: (toolCall) => describePush(toolCall.args),
    },
  };
}

/** « Envoyer US-004, US-005 dans le kanban Notion (colonne « Prêt ») » (pure). */
export function describePush(args: Record<string, unknown>): string {
  const ids = Array.isArray(args.item_ids) ? args.item_ids.map(String) : [];
  const what = args.epic_id
    ? `l'epic ${String(args.epic_id)} (ses éléments pas encore envoyés)`
    : ids.join(", ") || "ces éléments";
  return `Envoyer ${what} dans le kanban Notion (colonne « Prêt »)`;
}

/** The pages a push would create, resolved as the tool will (an epic becomes its items). */
async function pushPreview(db: Db, args: Record<string, unknown>): Promise<string> {
  try {
    const ids = await resolvePushIds(db, {
      item_ids: Array.isArray(args.item_ids) ? args.item_ids.map(String) : undefined,
      epic_id: typeof args.epic_id === "string" ? args.epic_id : undefined,
    });
    return await previewPush(db, ids);
  } catch (error) {
    if (error instanceof PushTargetError) return error.message;
    throw error;
  }
}

export type ApprovalAction = {
  tool: string;
  args: Record<string, unknown>;
  /** The exact content in plain words. */
  description: string;
  allowed: DecisionType[];
  /** Title of the targeted insight or backlog item, and an insight's statement (form prefill). */
  target_title: string | null;
  target_statement: string | null;
  /** push_to_notion: each page as Notion will receive it. */
  preview: string | null;
};

export type PendingApproval = { interrupt_id: string; actions: ApprovalAction[] };

type RawInterrupt = { id?: string; value?: unknown };

/** The pending approval of an interrupt list (stream update or state tasks), if any (pure). */
export function toPendingApproval(interrupts: unknown): PendingApproval | null {
  const list = (Array.isArray(interrupts) ? interrupts : [interrupts]) as RawInterrupt[];
  for (const item of list) {
    const value = item?.value as Partial<HITLRequest> | undefined;
    if (!value?.actionRequests?.length) continue;
    const configs = value.reviewConfigs ?? [];
    return {
      interrupt_id: item.id ?? "",
      actions: value.actionRequests.map((a) => ({
        tool: a.name,
        args: a.args,
        description: a.description ?? a.name,
        allowed: configs.find((c) => c.actionName === a.name)?.allowedDecisions ?? [
          "approve",
          "reject",
        ],
        target_title: null,
        target_statement: null,
        preview: null,
      })),
    };
  }
  return null;
}

/**
 * Adds the target's title (and an insight's statement) so the card reads in plain words, and the
 * Notion rendering of the pages a push_to_notion would create.
 */
export async function withTargets(db: Db, approval: PendingApproval): Promise<PendingApproval> {
  const targets = approval.actions.map((a) => String(a.args.target ?? ""));
  const insightIds = targets.filter((t) => /^I-\d+$/.test(t));
  const itemIds = targets.filter((t) => /^(?:US|BUG|TT)-\d+$/.test(t));
  const [insights, items] = await Promise.all([
    insightIds.length
      ? db.from("insights").select("id, title, problem_statement").in("id", insightIds)
      : Promise.resolve({
          data: [] as { id: string; title: string; problem_statement: string | null }[],
        }),
    itemIds.length
      ? db.from("backlog_items").select("id, title").in("id", itemIds)
      : Promise.resolve({ data: [] as { id: string; title: string }[] }),
  ]);
  const insightOf = new Map((insights.data ?? []).map((i) => [i.id, i]));
  const itemOf = new Map((items.data ?? []).map((i) => [i.id, i]));
  const previews = await Promise.all(
    approval.actions.map((a) =>
      a.tool === "push_to_notion" ? pushPreview(db, a.args) : Promise.resolve(null),
    ),
  );
  return {
    ...approval,
    actions: approval.actions.map((a, i) => {
      const target = String(a.args.target ?? "");
      const insight = insightOf.get(target);
      return {
        ...a,
        target_title: insight?.title ?? itemOf.get(target)?.title ?? null,
        target_statement: insight?.problem_statement ?? null,
        preview: previews[i],
      };
    }),
  };
}

/** Léa's choice on one action of the card. */
export const cardDecisionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("approve") }),
  z.object({ type: z.literal("edit"), args: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("reject"), reason: z.string().trim().max(500).optional() }),
]);

export type CardDecision = z.infer<typeof cardDecisionSchema>;

export const resumeRequestSchema = z.object({
  thread_id: z.uuid(),
  interrupt_id: z.string().max(200),
  decisions: z.array(cardDecisionSchema).min(1).max(10),
});

export type ResumeRequest = z.infer<typeof resumeRequestSchema>;

/**
 * Checks Léa's choices against the pending card (pure): one choice per action, an allowed type,
 * an edit that keeps the decision's kind and target and passes the checks of apply_decision.
 */
export function checkCardDecisions(
  approval: PendingApproval,
  decisions: readonly CardDecision[],
  weighting: Weighting,
): string | null {
  if (decisions.length !== approval.actions.length) {
    return `Une réponse attendue par action (${approval.actions.length}).`;
  }
  for (const [i, decision] of decisions.entries()) {
    const action = approval.actions[i];
    if (!action.allowed.includes(decision.type)) {
      return `Choix « ${decision.type} » impossible pour ${action.tool}.`;
    }
    if (decision.type !== "edit") continue;
    if (decision.args.kind !== action.args.kind || decision.args.target !== action.args.target) {
      return "Une modification garde le type de décision et sa cible.";
    }
    if (action.tool === "apply_decision") {
      const checked = checkDecision(decision.args, weighting);
      if (!checked.ok) return `${checked.error}.`;
    }
  }
  return null;
}

/**
 * The middleware's resume value. A refusal tells the model what happened and that the refusal is
 * logged, so it neither retries nor insists (skill challenge).
 */
export function toHitlResponse(
  approval: PendingApproval,
  decisions: readonly CardDecision[],
  refusals: readonly (string | null)[],
): HITLResponse {
  return {
    decisions: decisions.map((d, i) => {
      if (d.type === "approve") return { type: "approve" };
      if (d.type === "edit") {
        return { type: "edit", editedAction: { name: approval.actions[i].tool, args: d.args } };
      }
      const logged = refusals[i] ? ` Refus journalisé (${refusals[i]}).` : "";
      const why = d.reason ? ` Raison : ${d.reason}.` : "";
      return {
        type: "reject",
        message: `Léa a refusé cette proposition : rien n'a été appliqué.${why}${logged} Prends-en acte en une phrase, sans la reproposer.`,
      };
    }),
  };
}

export const UNANSWERED_CARD =
  "Léa a continué la conversation sans répondre à la carte d'approbation : rien n'a été appliqué. Ne la repropose pas, sauf si elle le demande.";

/**
 * Léa wrote instead of answering a card: nothing blocks (SPEC §8.10). The tool calls left without
 * a result get one, placed before her new message, so the conversation stays valid for the model
 * (pure).
 */
export function danglingToolResults(messages: readonly BaseMessage[]): ToolMessage[] {
  const last = messages.findLast((m) => AIMessage.isInstance(m));
  if (!last || !AIMessage.isInstance(last) || !last.tool_calls?.length) return [];
  const index = messages.lastIndexOf(last);
  const answered = new Set(
    messages
      .slice(index + 1)
      .filter((m) => ToolMessage.isInstance(m))
      .map((m) => (m as ToolMessage).tool_call_id),
  );
  return last.tool_calls
    .filter((c) => c.id && !answered.has(c.id))
    .map(
      (c) =>
        new ToolMessage({
          content: UNANSWERED_CARD,
          tool_call_id: c.id!,
          name: c.name,
          status: "error",
        }),
    );
}
