import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";
import { Command, MemorySaver } from "@langchain/langgraph";
import { AIMessage, HumanMessage, ToolMessage, type BaseMessage } from "langchain";
import { describe, expect, it } from "vitest";
import { loadContextPack } from "@/lib/context";
import { applyDecisionSchema } from "@/lib/decisions/apply-decision";
import { RunCost } from "@/lib/llm/cost";
import { listSkills } from "@/lib/skills";
import {
  checkCardDecisions,
  danglingToolResults,
  toHitlResponse,
  toPendingApproval,
  UNANSWERED_CARD,
  type PendingApproval,
} from "./approval";
import { createSignalAgent, pendingApproval, turnMessages } from "./index";
import { signalTool, type AgentDeps, type TurnContext } from "./tools/shared";

const pack = await loadContextPack();
const skills = await listSkills();

/** A chat model that follows a script: no network (rule 11). */
class ScriptedModel extends BaseChatModel {
  calls = 0;
  constructor(private readonly script: (messages: BaseMessage[], call: number) => AIMessage) {
    super({});
  }
  _llmType() {
    return "scripted";
  }
  bindTools() {
    return this;
  }
  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    const message = this.script(messages, this.calls++);
    return { generations: [{ text: message.text, message }] };
  }
}

/** The real tool's name and schema; records what it would apply. */
function fakeApplyDecision() {
  const applied: unknown[] = [];
  const tool = signalTool(
    {
      name: "apply_decision",
      summary: "Test.",
      when: "test",
      notWhen: "jamais",
      schema: applyDecisionSchema,
    },
    async (input) => {
      applied.push(input);
      return { applique: true };
    },
  );
  return { tool, applied };
}

const MUST = { kind: "moscow", target: "I-04", value: "must", reason: "Salon" };

function setup(proposal: Record<string, unknown> = MUST) {
  const { tool, applied } = fakeApplyDecision();
  const model = new ScriptedModel((messages, call) => {
    const last = messages.at(-1);
    if (ToolMessage.isInstance(last)) return new AIMessage(`Résultat : ${last.text.slice(0, 80)}`);
    return new AIMessage({
      content: "",
      tool_calls: [{ id: `call-${call}`, name: "apply_decision", args: proposal }],
      response_metadata: { usage: { input_tokens: 100, output_tokens: 20 } },
    });
  });
  const agent = createSignalAgent({
    deps: { pack } as unknown as AgentDeps,
    skills,
    checkpointer: new MemorySaver(),
    model,
    summaryModel: model,
    tools: [tool],
  });
  const config = (thread: string) => ({
    configurable: { thread_id: thread },
    context: { threadId: thread, runCost: new RunCost(), page: null } satisfies TurnContext,
    recursionLimit: 100,
  });
  return { agent, applied, model, config };
}

describe("human-in-the-loop on apply_decision (SPEC §10.6)", () => {
  it("pauses before writing, then applies on approval", async () => {
    const { agent, applied, config } = setup();
    const first = config("a");
    await agent.invoke({ messages: turnMessages("Passe le Gantt en Must", "briefing") }, first);
    expect(applied).toHaveLength(0);
    // The model call that proposed the decision is costed before the pause.
    expect(first.context.runCost.tokensIn).toBe(100);
    const pending = await pendingApproval(agent, "a");
    expect(pending?.approval.actions).toMatchObject([
      {
        tool: "apply_decision",
        args: MUST,
        description: "MoSCoW final de I-04 : Must",
        allowed: ["approve", "edit", "reject"],
      },
    ]);

    const response = toHitlResponse(pending!.approval, [{ type: "approve" }], [null]);
    const state = await agent.invoke(new Command({ resume: response }), config("a"));
    expect(applied).toEqual([MUST]);
    expect(state.messages.at(-1)!.text).toMatch(/^Résultat/);
    expect(await pendingApproval(agent, "a")).toBeNull();
  });

  it("applies Léa's edit instead of the proposal", async () => {
    const { agent, applied, config } = setup();
    await agent.invoke({ messages: turnMessages("Passe le Gantt en Must", "b") }, config("b"));
    const pending = await pendingApproval(agent, "b");
    const edited = { ...MUST, value: "should", reason: "Should suffit" };
    await agent.invoke(
      new Command({
        resume: toHitlResponse(pending!.approval, [{ type: "edit", args: edited }], [null]),
      }),
      config("b"),
    );
    expect(applied).toEqual([edited]);
  });

  it("applies nothing on refusal and tells the model it is logged", async () => {
    const { agent, applied, config } = setup();
    await agent.invoke({ messages: turnMessages("Passe le Gantt en Must", "c") }, config("c"));
    const pending = await pendingApproval(agent, "c");
    const state = await agent.invoke(
      new Command({
        resume: toHitlResponse(
          pending!.approval,
          [{ type: "reject", reason: "Pas ce trimestre" }],
          ["D-042"],
        ),
      }),
      config("c"),
    );
    expect(applied).toHaveLength(0);
    const refusal = state.messages.find((m) => ToolMessage.isInstance(m))!;
    expect(refusal.text).toContain("Léa a refusé");
    expect(refusal.text).toContain("Pas ce trimestre");
    expect(refusal.text).toContain("D-042");
  });

  it("never shows a card for an invalid proposal: the tool refuses it (CL-23)", async () => {
    const invalid = { kind: "override", target: "I-04", param: "impact", value: 4, reason: "r" };
    const { agent, config } = setup(invalid);
    await agent.invoke({ messages: turnMessages("Mets l'Impact à 4", "d") }, config("d"));
    expect(await pendingApproval(agent, "d")).toBeNull();
  });

  it("drops a card Léa did not answer when she writes again: nothing applied, valid history", async () => {
    const { agent, applied, config, model } = setup();
    await agent.invoke({ messages: turnMessages("Passe le Gantt en Must", "e") }, config("e"));
    const pending = await pendingApproval(agent, "e");
    const dropped = danglingToolResults(pending!.messages);
    expect(dropped).toHaveLength(1);
    expect(dropped[0].text).toBe(UNANSWERED_CARD);

    // The model answers the new question in text this time.
    const before = model.calls;
    const state = await agent.invoke(
      { messages: [...dropped, ...turnMessages("Autre chose : quoi de neuf ?", "e")] },
      config("e"),
    );
    expect(model.calls).toBeGreaterThan(before);
    expect(applied).toHaveLength(0);
    // Every tool call is answered before Léa's next message.
    const messages = state.messages as BaseMessage[];
    const call = messages.findIndex((m) => AIMessage.isInstance(m) && m.tool_calls?.length);
    expect(ToolMessage.isInstance(messages[call + 1])).toBe(true);
    expect(HumanMessage.isInstance(messages[call + 2])).toBe(true);
  });
});

const approval: PendingApproval = {
  interrupt_id: "int-1",
  actions: [
    {
      tool: "apply_decision",
      args: MUST,
      description: "MoSCoW final de I-04 : Must",
      allowed: ["approve", "edit", "reject"],
      target_title: null,
      target_statement: null,
    },
  ],
};

describe("approval helpers", () => {
  it("reads the card from the middleware's interrupt", () => {
    expect(
      toPendingApproval([
        {
          id: "x",
          value: {
            actionRequests: [{ name: "push_to_notion", args: { item_ids: ["US-001"] } }],
            reviewConfigs: [
              { actionName: "push_to_notion", allowedDecisions: ["approve", "reject"] },
            ],
          },
        },
      ]),
    ).toMatchObject({
      interrupt_id: "x",
      actions: [{ tool: "push_to_notion", allowed: ["approve", "reject"] }],
    });
    expect(toPendingApproval([])).toBeNull();
    expect(toPendingApproval([{ id: "y", value: "autre interruption" }])).toBeNull();
  });

  it("checks Léa's answer against the card", () => {
    const { weighting } = pack;
    expect(checkCardDecisions(approval, [{ type: "approve" }], weighting)).toBeNull();
    expect(checkCardDecisions(approval, [], weighting)).toMatch(/Une réponse attendue/);
    expect(
      checkCardDecisions(
        approval,
        [{ type: "edit", args: { ...MUST, kind: "override" } }],
        weighting,
      ),
    ).toMatch(/garde le type/);
    expect(
      checkCardDecisions(
        approval,
        [{ type: "edit", args: { ...MUST, target: "I-05" } }],
        weighting,
      ),
    ).toMatch(/garde le type/);
    expect(
      checkCardDecisions(
        approval,
        [{ type: "edit", args: { ...MUST, value: "urgent" } }],
        weighting,
      ),
    ).toMatch(/MoSCoW attendu/);
    const notion = {
      ...approval,
      actions: [{ ...approval.actions[0], allowed: ["approve" as const] }],
    };
    expect(checkCardDecisions(notion, [{ type: "reject" }], weighting)).toMatch(/impossible/);
  });

  it("leaves no dangling call when the last answer has none", () => {
    expect(danglingToolResults([new HumanMessage("x"), new AIMessage("Réponse")])).toEqual([]);
  });
});
