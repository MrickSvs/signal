import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { RunCost } from "./cost";
import { getModel } from "./index";
import { invokeStructured, StructuredOutputError } from "./structured";

vi.mock("./index", () => ({ getModel: vi.fn() }));

const invoke = vi.fn();
const withConfig = vi.fn().mockReturnValue({ invoke });

const schema = z.object({
  type: z.enum(["bug", "question"]),
  sentiment: z.number().int().min(-2).max(2),
});
const messages = [new HumanMessage("retour")];

const reply = (content: AIMessage["content"], inputTokens = 100) =>
  new AIMessage({
    content,
    response_metadata: { usage: { input_tokens: inputTokens, output_tokens: 10 } },
  });

beforeEach(() => {
  invoke.mockReset();
  withConfig.mockClear();
  vi.mocked(getModel).mockReturnValue({ withConfig } as never);
});

describe("invokeStructured", () => {
  it("uses native structured outputs and names the generation", async () => {
    invoke.mockResolvedValueOnce(reply('{"type":"bug","sentiment":-1}'));
    const result = await invokeStructured("triage", schema, messages, {
      name: "classify-feedback",
    });
    expect(result.data).toEqual({ type: "bug", sentiment: -1 });
    expect(result.attempts).toBe(1);
    const config = withConfig.mock.calls[0][0] as {
      outputConfig: { format: { type: string; schema: { properties: object } } };
    };
    expect(config.outputConfig.format.type).toBe("json_schema");
    expect(Object.keys(config.outputConfig.format.schema.properties)).toEqual([
      "type",
      "sentiment",
    ]);
    expect(invoke.mock.calls[0][1]).toMatchObject({ runName: "classify-feedback" });
  });

  it("ignores thinking blocks and reads the text block", async () => {
    invoke.mockResolvedValueOnce(
      reply([
        { type: "thinking", thinking: "je réfléchis", signature: "sig" },
        { type: "text", text: '{"type":"question","sentiment":0}' },
      ]),
    );
    const result = await invokeStructured("reasoning", schema, messages, { name: "name-insight" });
    expect(result.data).toEqual({ type: "question", sentiment: 0 });
  });

  it("retries once when the output is invalid, then succeeds", async () => {
    invoke
      .mockResolvedValueOnce(reply('{"type":"bug","sentiment":7}', 100))
      .mockResolvedValueOnce(reply('{"type":"question","sentiment":0}', 120));
    const runCost = new RunCost();
    const result = await invokeStructured("triage", schema, messages, {
      name: "classify-feedback",
      runCost,
    });
    expect(result.data).toEqual({ type: "question", sentiment: 0 });
    expect(result.attempts).toBe(2);
    expect(result.usage.inputTokens).toBe(220);
    expect(runCost.tokensIn).toBe(220);
    expect(result.costEur).toBeGreaterThan(0);
  });

  it("throws a typed validation error after the second invalid output", async () => {
    invoke.mockResolvedValue(reply("pas du JSON"));
    const error = await invokeStructured("triage", schema, messages, {
      name: "classify-feedback",
    }).catch((e) => e);
    expect(error).toBeInstanceOf(StructuredOutputError);
    expect(error.kind).toBe("validation");
    expect(error.attempts).toBe(2);
    expect(error.usage.inputTokens).toBe(200);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("throws a typed api error without retrying (the SDK already retried)", async () => {
    invoke.mockRejectedValueOnce(new Error("529 overloaded"));
    const error = await invokeStructured("reasoning", schema, messages, {
      name: "name-insight",
    }).catch((e) => e);
    expect(error).toBeInstanceOf(StructuredOutputError);
    expect(error.kind).toBe("api");
    expect(error.cause).toBeInstanceOf(Error);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
