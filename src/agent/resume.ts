// Léa answers an approval card (SPEC §10.6): her choices are checked against the pending card, a
// refusal is logged in `decisions` (the middleware never runs a refused tool), then the run resumes
// from the checkpointer where it paused. Shared by POST /api/agent/resume and the terminal chat.
import { logRefusal } from "@/services/apply-decision";
import { checkCardDecisions, toHitlResponse, type CardDecision } from "./approval";
import type { PageContext } from "./briefing";
import { pendingApproval, runTurn, type AgentEvent, type SignalAgent } from "./index";
import type { AgentDeps } from "./tools";

/** A refused resume (no card, stale card, invalid edit): the message is shown to Léa as is. */
export class ResumeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResumeError";
  }
}

export type ResumeInput = {
  threadId: string;
  /** The card Léa answers: a stale card (already answered, dropped) is refused. */
  interruptId: string;
  decisions: CardDecision[];
  page: PageContext | null;
};

/** Checks Léa's answer before anything is written; throws ResumeError when it is refused. */
export async function checkResume(agent: SignalAgent, deps: AgentDeps, input: ResumeInput) {
  const pending = await pendingApproval(agent, input.threadId);
  if (!pending || pending.approval.interrupt_id !== input.interruptId) {
    throw new ResumeError("Cette carte n'attend plus de réponse (déjà traitée ou remplacée).");
  }
  const error = checkCardDecisions(pending.approval, input.decisions, deps.pack.weighting);
  if (error) throw new ResumeError(error);
  return pending.approval;
}

export async function resumeTurn(
  agent: SignalAgent,
  deps: AgentDeps,
  input: ResumeInput,
  emit: (event: AgentEvent) => void | Promise<void>,
) {
  const approval = await checkResume(agent, deps, input);
  const refusals = await Promise.all(
    input.decisions.map((d, i) =>
      d.type === "reject"
        ? logRefusal(
            deps.db,
            approval.actions[i].args,
            { pack: deps.pack, source: "chat" },
            d.reason,
          )
        : Promise.resolve(null),
    ),
  );
  return runTurn(
    agent,
    deps,
    {
      threadId: input.threadId,
      page: input.page,
      resume: toHitlResponse(approval, input.decisions, refusals),
    },
    emit,
  );
}
