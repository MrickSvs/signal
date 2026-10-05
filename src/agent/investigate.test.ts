import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ChatResult } from "@langchain/core/outputs";
import { AIMessage, ToolMessage, type BaseMessage } from "langchain";
import { describe, expect, it } from "vitest";
import { loadContextPack, type ContextPack } from "@/lib/context";
import { createMemoryDb, type MemoryTables } from "@/lib/db/memory";
import { listSkills } from "@/lib/skills";
import {
  alertAccount,
  dossierErrors,
  dossierIds,
  investigate,
  investigationBrief,
  investigationTools,
  pendingInvestigations,
  renderDossier,
  SUBMIT_DOSSIER,
  type Dossier,
} from "./investigate";
import { chatTools, readTools, type AgentDeps } from "./tools";
import { signalTool } from "./tools/shared";
import { z } from "zod";

const pack = await loadContextPack();
const skills = await listSkills();

/** A chat model that follows a script: no network (rule 11), records what it receives. */
class ScriptedModel extends BaseChatModel {
  received: BaseMessage[][] = [];
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
    this.received.push(messages);
    const message = this.script(messages, this.received.length - 1);
    return { generations: [{ text: message.text, message }] };
  }
}

const ALERT_ID = "00000000-0000-4000-8000-000000000001";

function world(): MemoryTables {
  return {
    alerts: [
      {
        id: ALERT_ID,
        kind: "churn",
        insight_id: "I-27",
        feedback_ids: ["R-226"],
        dedup_key: "churn|compte:C-013|2026-10-05T10:00:00.000Z",
        status: "nouvelle",
        dossier: null,
        dossier_markdown: null,
        dossier_status: "en_cours",
        cost_eur: null,
        langfuse_url: null,
        created_at: "2026-10-05T10:00:00.000Z",
      },
    ],
    insights: [
      { id: "I-27", status: "actif", title: "Notifications en double" },
      { id: "I-52", status: "propose", title: "Accessibilité" },
    ],
    feedbacks: [{ id: "R-226" }, { id: "R-120" }],
    customers: [{ id: "C-013" }],
  };
}

function depsFor(
  tables: MemoryTables,
  overrides: Partial<ContextPack["weighting"]["alerts"]> = {},
) {
  return {
    db: createMemoryDb(tables),
    pack: {
      ...pack,
      weighting: { ...pack.weighting, alerts: { ...pack.weighting.alerts, ...overrides } },
    },
    skills: { triage: "", riceScoring: "", moscow: "" },
    now: () => new Date("2026-10-05T12:00:00.000Z"),
    withLock: (fn: () => Promise<unknown>) => fn(),
  } as unknown as AgentDeps;
}

const dossier = (patch: Partial<Dossier> = {}): Dossier => ({
  titre: "Studio Bastide regarde un concurrent avant son renouvellement",
  faits: [
    { texte: "R-226 cite un concurrent et les notifications en double.", ids: ["R-226"] },
    { texte: "Le compte renouvelle bientôt.", ids: ["C-013"] },
  ],
  lecture: "Le sujet I-27 pèse sur un renouvellement. Le risque est concret.",
  recommandation: "Prévenir le CSM et traiter I-27 en priorité.",
  confiance: "moyenne",
  action: { type: "prevenir_csm", cible: "C-013", raison: "Renouvellement proche." },
  ...patch,
});

const submitCall = (d: Dossier, id = "s1") =>
  new AIMessage({ content: "", tool_calls: [{ id, name: SUBMIT_DOSSIER, args: d }] });

describe("investigation tools (CL-57)", () => {
  const deps = depsFor(world());
  const submit = signalTool(
    { name: SUBMIT_DOSSIER, summary: "t", when: "t", notWhen: "t", schema: z.object({}) },
    async () => "ok",
  );

  it("exposes the read tools and the submission only: no tool that writes or sends", () => {
    const names = investigationTools(deps, submit).map((t) => t.name);
    expect(names).toEqual([...readTools(deps).map((t) => t.name), SUBMIT_DOSSIER]);
    const writers = chatTools(deps)
      .map((t) => t.name)
      .filter((n) => !readTools(deps).some((t) => t.name === n));
    expect(writers.length).toBeGreaterThan(0);
    for (const name of [...writers, "push_to_notion", "generate_prototype"]) {
      expect(names).not.toContain(name);
    }
    expect(names).toEqual(
      expect.arrayContaining(["estimate_complexity", "load_skill", "get_insight"]),
    );
  });
});

describe("dossier checks (pure)", () => {
  const known = new Set(["R-226", "C-013", "I-27", "I-52"]);

  it("collects the ids of the facts, of the target and of the text", () => {
    const d = dossier({ lecture: "Voir aussi R-120 et I-27." });
    expect(dossierIds(d)).toEqual(expect.arrayContaining(["R-226", "C-013", "R-120", "I-27"]));
  });

  it("accepts a dossier whose ids exist and whose action fits its target", () => {
    expect(dossierErrors(dossier(), known, { kind: "customer" })).toEqual([]);
  });

  it("rejects a dossier that cites an id that does not exist", () => {
    const d = dossier({ faits: [...dossier().faits, { texte: "Et R-999.", ids: ["R-999"] }] });
    expect(dossierErrors(d, known, { kind: "customer" })).toEqual([
      expect.stringContaining("R-999"),
    ]);
  });

  it("checks the action against the closed list and its target", () => {
    const action = (type: Dossier["action"]["type"], cible: string | null) =>
      dossier({ action: { type, cible, raison: "r" } });
    const insight = (status: "propose" | "actif" | "rejete") =>
      ({ kind: "insight", status }) as const;
    expect(dossierErrors(action("valider_insight", "I-52"), known, insight("propose"))).toEqual([]);
    expect(dossierErrors(action("valider_insight", "I-27"), known, insight("actif"))).toHaveLength(
      1,
    );
    expect(dossierErrors(action("rediger_backlog", "I-27"), known, insight("actif"))).toEqual([]);
    expect(dossierErrors(action("rediger_backlog", "I-27"), known, insight("rejete"))).toHaveLength(
      1,
    );
    expect(
      dossierErrors(action("rediger_backlog", "C-013"), known, { kind: "customer" }),
    ).toHaveLength(1);
    expect(dossierErrors(action("prevenir_csm", "I-27"), known, insight("actif"))).toHaveLength(1);
    expect(dossierErrors(action("prevenir_csm", null), known, null)).toHaveLength(1);
    expect(dossierErrors(action("aucune", null), known, null)).toEqual([]);
    expect(dossierErrors(action("aucune", "I-27"), known, insight("actif"))).toHaveLength(1);
  });

  it("renders a dossier readable in 20 seconds", () => {
    const md = renderDossier(dossier());
    expect(md).toContain("**Faits**");
    expect(md).toContain("(C-013)"); // an id missing from the fact's text is appended
    expect(md).toContain("confiance moyenne");
    expect(md).toContain("**Action proposée** — Prévenir le CSM C-013");
  });

  it("states the alert, its account and its evidence in the entry message", () => {
    const [alert] = world().alerts as never[];
    expect(alertAccount(alert)).toBe("C-013");
    const brief = investigationBrief(alert, new Date("2026-10-05T12:00:00.000Z"));
    expect(brief).toContain("Risque de churn");
    expect(brief).toContain("C-013");
    expect(brief).toContain("R-226");
    expect(brief).toContain(SUBMIT_DOSSIER);
  });
});

describe("investigate (simulated model)", () => {
  it("stores a verified dossier: status pret, markdown, cost", async () => {
    const tables = world();
    const model = new ScriptedModel(() => submitCall(dossier()));
    const result = await investigate(ALERT_ID, depsFor(tables), { skills, model });
    expect(result.status).toBe("pret");
    expect(model.received).toHaveLength(1); // the run stops once the dossier is accepted
    const alert = tables.alerts[0];
    expect(alert.dossier_status).toBe("pret");
    expect(alert.dossier).toMatchObject({ action: { type: "prevenir_csm", cible: "C-013" } });
    expect(alert.dossier_markdown).toContain("Prévenir le CSM");
    expect(alert.cost_eur).toBe(0);
    expect(await pendingInvestigations(createMemoryDb(tables))).toEqual([]);
  });

  it("rejects a dossier citing an unknown id; without a valid one the alert has no dossier", async () => {
    const tables = world();
    const bad = dossier({ lecture: "Comme R-999 le montre." });
    const model = new ScriptedModel((messages, call) =>
      call < 2 ? submitCall(bad, `s${call}`) : new AIMessage("Je n'y arrive pas."),
    );
    const result = await investigate(ALERT_ID, depsFor(tables), { skills, model });
    const refusals = model.received[1].filter((m) => ToolMessage.isInstance(m));
    expect(String(refusals.at(-1)?.content)).toContain("R-999");
    expect(result.status).toBe("echec");
    expect(tables.alerts[0].dossier_status).toBe("echec");
    expect(tables.alerts[0].dossier_markdown).toBeNull();
  });

  it("marks the dossier as failed when the model fails (CL-56)", async () => {
    const tables = world();
    const model = new ScriptedModel(() => {
      throw new Error("529 overloaded");
    });
    const result = await investigate(ALERT_ID, depsFor(tables), { skills, model });
    expect(result.status).toBe("echec");
    expect(result.error).toContain("529");
    expect(tables.alerts[0]).toMatchObject({ dossier_status: "echec", cost_eur: 0 });
  });

  it("stops beyond the tool-call budget, without a dossier (CL-56)", async () => {
    const tables = world();
    const model = new ScriptedModel(
      (_m, call) =>
        new AIMessage({
          content: "",
          tool_calls: [{ id: `l${call}`, name: "load_skill", args: { name: "challenge" } }],
        }),
    );
    const result = await investigate(
      ALERT_ID,
      depsFor(tables, { investigation_max_tool_calls: 2 }),
      {
        skills,
        model,
      },
    );
    expect(model.received).toHaveLength(3);
    expect(result).toMatchObject({ status: "echec", error: expect.stringContaining("2 appels") });
  });

  it("stops beyond the cost budget and records the cost (CL-56)", async () => {
    const tables = world();
    const model = new ScriptedModel(
      () =>
        new AIMessage({
          content: "",
          tool_calls: [{ id: "l", name: "load_skill", args: { name: "challenge" } }],
          response_metadata: { usage: { input_tokens: 100_000, output_tokens: 1_000 } },
        }),
    );
    const result = await investigate(ALERT_ID, depsFor(tables), { skills, model });
    expect(model.received).toHaveLength(1);
    expect(result.status).toBe("echec");
    expect(result.error).toContain("budget");
    expect(Number(tables.alerts[0].cost_eur)).toBeGreaterThan(0.05);
  });

  it("fails cleanly on an unknown alert", async () => {
    const model = new ScriptedModel(() => submitCall(dossier()));
    const result = await investigate("00000000-0000-4000-8000-000000000099", depsFor(world()), {
      skills,
      model,
    });
    expect(result).toMatchObject({
      status: "echec",
      error: expect.stringContaining("introuvable"),
    });
  });
});
