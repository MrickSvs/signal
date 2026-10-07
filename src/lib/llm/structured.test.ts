import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { RunCost } from "./cost";
import { getModel } from "./index";
import {
  invokeStructured,
  stripJsonLeaks,
  StructuredOutputError,
  toStrictJsonSchema,
} from "./structured";

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

  it("prompt mode: schema in the prompt, no constrained decoding, fenced JSON read, same retry", async () => {
    const plain = { invoke, withConfig };
    vi.mocked(getModel).mockReturnValue(plain as never);
    invoke
      .mockResolvedValueOnce(reply('```json\n{"type":"autre","sentiment":0}\n```'))
      .mockResolvedValueOnce(reply('```json\n{"type":"bug","sentiment":0}\n```'));
    const result = await invokeStructured("agent", schema, messages, {
      name: "draft-backlog-items",
      schemaMode: "prompt",
      maxTokens: 16000,
    });
    expect(result).toMatchObject({ data: { type: "bug", sentiment: 0 }, attempts: 2 });
    expect(withConfig).not.toHaveBeenCalled();
    expect(getModel).toHaveBeenCalledWith("agent", { maxTokens: 16000 });
    const first = invoke.mock.calls[0][0] as BaseMessage[];
    expect(first).toHaveLength(2);
    expect(String(first[1].content)).toContain('"sentiment"');
    // The retry keeps the schema and adds the invalid answer and its issues.
    const second = invoke.mock.calls[1][0] as BaseMessage[];
    expect(second).toHaveLength(4);
    expect(String(second[1].content)).toContain("schéma JSON");
  });

  it("passes the effort of the call with the output format", async () => {
    invoke.mockResolvedValueOnce(reply('{"type":"bug","sentiment":0}'));
    await invokeStructured("reasoning", schema, messages, { name: "x", effort: "low" });
    const config = withConfig.mock.calls[0][0] as { outputConfig: { effort: string } };
    expect(config.outputConfig).toMatchObject({ effort: "low", format: { type: "json_schema" } });
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
    const retry = invoke.mock.calls[1][0] as BaseMessage[];
    expect(retry).toHaveLength(3);
    expect(retry[1].content).toBe('{"type":"bug","sentiment":7}');
    expect(retry[2].content).toMatch(/ne respecte pas le schéma[\s\S]*sentiment/);
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

describe("stripJsonLeaks", () => {
  it("drops JSON punctuation left after the last sentence of a text field", () => {
    expect(stripJsonLeaks("pas de découpage nécessaire.}],")).toBe("pas de découpage nécessaire.");
    expect(stripJsonLeaks('Fin de phrase ! "}]')).toBe("Fin de phrase !");
    expect(stripJsonLeaks("Voir (T-128)]}")).toBe("Voir (T-128)");
  });

  it("keeps legitimate endings and walks nested values", () => {
    expect(stripJsonLeaks("liste [a, b]")).toBe("liste [a, b]");
    expect(stripJsonLeaks("Phrase.")).toBe("Phrase.");
    expect(stripJsonLeaks("un, deux,")).toBe("un, deux,");
    expect(
      stripJsonLeaks({ items: [{ rationale: "Trois points.}]", points: 3 }], note: null }),
    ).toEqual({ items: [{ rationale: "Trois points.", points: 3 }], note: null });
  });
});

describe("toStrictJsonSchema", () => {
  it("keeps enums (nested, in arrays and nullable unions) and drops unsupported keywords", () => {
    const strict = toStrictJsonSchema(
      z.object({
        level: z.enum(["basse", "haute"]),
        items: z.array(z.object({ area: z.enum(["taches", "autre"]) })).max(3),
        maybe: z.enum(["a", "b"]).nullable(),
        score: z.number().min(0).max(1),
      }),
    ) as {
      properties: {
        level: { enum: string[] };
        items: { items: { properties: { area: { enum: string[] } } }; maxItems?: number };
        maybe: { anyOf: { enum?: string[] }[] };
        score: { minimum?: number; description: string };
      };
    };
    expect(strict.properties.level.enum).toEqual(["basse", "haute"]);
    expect(strict.properties.items.items.properties.area.enum).toEqual(["taches", "autre"]);
    expect(strict.properties.items.maxItems).toBeUndefined();
    expect(strict.properties.maybe.anyOf.some((v) => v.enum?.includes("a"))).toBe(true);
    expect(strict.properties.score.minimum).toBeUndefined();
    expect(strict.properties.score.description).toContain("minimum");
  });

  it("enforces the discriminant of a union as a one-value enum", () => {
    const strict = toStrictJsonSchema(
      z.object({
        items: z.array(
          z.discriminatedUnion("kind", [
            z.object({ kind: z.literal("story"), want: z.string() }),
            z.object({ kind: z.literal("bug"), severity: z.enum(["majeur", "mineur"]) }),
          ]),
        ),
      }),
    ) as {
      properties: {
        items: { items: { anyOf: { properties: { kind: { enum: string[] } } }[] } };
      };
    };
    const variants = strict.properties.items.items.anyOf;
    expect(variants.map((v) => v.properties.kind.enum)).toEqual([["story"], ["bug"]]);
  });
});
