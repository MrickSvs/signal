// Scripted conversations with the real Signal agent (eval:guardrails): same model, prompt, tools
// and approval middleware as the chat, with three differences that keep the demo data intact:
// an in-memory checkpointer, the tools that write simulated (the model still chooses them freely:
// only their execution is replaced), and approval cards never answered (nothing is applied).
// The threads rows the turns create are deleted at the end.
import { MemorySaver } from "@langchain/langgraph";
import { AIMessage, ToolMessage, tool, type BaseMessage } from "langchain";
import { createSignalAgent, runTurn, threadState, type SignalAgent } from "@/agent";
import type { PendingApproval } from "@/agent/approval";
import type { PageContext } from "@/agent/briefing";
import { loadAgentDeps } from "@/agent/runtime";
import { chatTools, type AgentDeps, type SignalTool } from "@/agent/tools";
import type { Db } from "@/lib/db/create";
import type { SkillSummary } from "@/lib/skills";

/** Tools that write or send (SPEC §10.5, effect « écriture » or « externe »). */
export const WRITE_TOOLS = [
  "add_feedback",
  "draft_backlog_items",
  "update_backlog_item",
  "apply_decision",
  "push_to_notion",
  "generate_prototype",
];

export const SIMULATED_RESULT = "Évaluation : outil simulé, rien n'a été écrit.";

/** The same tools, those that write replaced by a stub with the same name, contract and schema. */
export function simulateWrites(tools: readonly SignalTool[]): SignalTool[] {
  return tools.map((t) =>
    WRITE_TOOLS.includes(t.name)
      ? (Object.assign(
          tool(async () => SIMULATED_RESULT, {
            name: t.name,
            description: t.description,
            schema: t.schema,
          }),
          { models: [] },
          // The schema comes from a SignalTool: the same structured tool, typed loosely.
        ) as unknown as SignalTool)
      : t,
  );
}

const PAGES: Record<string, string> = {
  digest: "/",
  retours: "/retours",
  insights: "/insights",
  insight: "/insights",
  prio: "/priorisation",
  backlog: "/backlog",
};

/** A page of the eval files ({page: "insight", entity_id}) as the chat panel sends it. */
export function toPageContext(page: { page: string; entity_id?: string | null }): PageContext {
  const path = PAGES[page.page];
  if (!path) throw new Error(`Page inconnue : ${page.page}`);
  return {
    page: page.entity_id ? `${path}/${page.entity_id}` : path,
    entity_id: page.entity_id ?? null,
  };
}

export type ToolCall = { name: string; args: Record<string, unknown> };

export type TurnTranscript = {
  answer: string;
  toolCalls: ToolCall[];
  /** Results of the tools, as the model read them. */
  toolOutputs: string[];
  interrupt: PendingApproval | null;
  costEur: number;
  traceId?: string;
  error?: string;
};

/** Calls and results of the messages a turn added (pure). */
export function turnActivity(messages: readonly BaseMessage[]) {
  const toolCalls: ToolCall[] = [];
  const toolOutputs: string[] = [];
  for (const m of messages) {
    if (AIMessage.isInstance(m))
      for (const c of m.tool_calls ?? []) toolCalls.push({ name: c.name, args: c.args });
    if (ToolMessage.isInstance(m))
      toolOutputs.push(typeof m.content === "string" ? m.content : JSON.stringify(m.content));
  }
  return { toolCalls, toolOutputs };
}

export class AgentHarness {
  private readonly threads = new Set<string>();

  private constructor(
    readonly db: Db,
    readonly deps: AgentDeps,
    readonly skills: readonly SkillSummary[],
    readonly agent: SignalAgent,
  ) {}

  static async create(db: Db): Promise<AgentHarness> {
    const { deps, skills } = await loadAgentDeps(db);
    // No alert investigation, no background work: nothing writes behind the conversation.
    const evalDeps: AgentDeps = { ...deps, onAlerts: undefined, background: () => {} };
    const agent = createSignalAgent({
      deps: evalDeps,
      skills,
      checkpointer: new MemorySaver(),
      tools: simulateWrites(chatTools(evalDeps)),
    });
    return new AgentHarness(db, evalDeps, skills, agent);
  }

  async turn(threadId: string, page: PageContext, message: string): Promise<TurnTranscript> {
    this.threads.add(threadId);
    const before =
      ((await threadState(this.agent, threadId)).values as { messages?: BaseMessage[] }).messages
        ?.length ?? 0;
    let answer = "";
    let interrupt: PendingApproval | null = null;
    let error: string | undefined;
    let costEur = 0;
    let traceId: string | undefined;
    try {
      const done = await runTurn(this.agent, this.deps, { threadId, page, message }, (event) => {
        if (event.type === "token") answer += event.text;
        else if (event.type === "interrupt") interrupt = event.approval;
        else if (event.type === "error") error = event.message;
      });
      costEur = done.cost_eur;
      traceId = done.langfuse_url?.match(/\/traces\/([^/?#]+)/)?.[1];
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    const messages =
      ((await threadState(this.agent, threadId)).values as { messages?: BaseMessage[] }).messages ??
      [];
    return {
      answer,
      ...turnActivity(messages.slice(before)),
      interrupt,
      costEur,
      traceId,
      error,
    };
  }

  /** Deletes the conversations the eval created from the threads list. */
  async cleanup(): Promise<void> {
    if (this.threads.size === 0) return;
    const { error } = await this.db
      .from("threads")
      .delete()
      .in("id", [...this.threads]);
    if (error) console.warn(`Nettoyage des conversations d'éval en échec (${error.message})`);
  }
}
