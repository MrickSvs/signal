// The agent's tools (SPEC §10.5): the nine read tools and add_feedback, the backlog drafting and
// edition, apply_decision and push_to_notion. The prototype tool of SPEC §10.5 (generate_prototype)
// is not built (ADR-031).
import { addFeedbackTool } from "./add-feedback";
import { applyDecisionTool } from "./apply-decision";
import { draftBacklogItemsTool } from "./draft-backlog-items";
import { estimateComplexityTool } from "./estimate-complexity";
import { getBriefingTool } from "./get-briefing";
import { getInsightTool } from "./get-insight";
import { getPriorityTool } from "./get-priority";
import { listBacklogTool } from "./list-backlog";
import { listInsightsTool } from "./list-insights";
import { loadSkillTool } from "./load-skill";
import { pushToNotionTool } from "./push-to-notion";
import { queryCustomersTool } from "./query-customers";
import { searchFeedbacksTool } from "./search-feedbacks";
import { updateBacklogItemTool } from "./update-backlog-item";
import type { AgentDeps, SignalTool } from "./shared";

/** Tools that only read (an alert investigation gets these and nothing else, SPEC §10.10). */
export function readTools(deps: AgentDeps, options: { skillsDir?: string } = {}): SignalTool[] {
  return [
    getBriefingTool(deps),
    searchFeedbacksTool(deps),
    listInsightsTool(deps),
    getInsightTool(deps),
    queryCustomersTool(deps),
    getPriorityTool(deps),
    estimateComplexityTool(deps),
    loadSkillTool(options.skillsDir),
    listBacklogTool(deps),
  ];
}

/** Every tool of the chat. */
export function chatTools(deps: AgentDeps, options: { skillsDir?: string } = {}): SignalTool[] {
  return [
    ...readTools(deps, options),
    addFeedbackTool(deps),
    draftBacklogItemsTool(deps),
    updateBacklogItemTool(deps),
    applyDecisionTool(deps),
    pushToNotionTool(deps),
  ];
}

export type { AgentDeps, SignalTool, TurnContext } from "./shared";
