// Contract of data/scenario.yaml (SPEC §5), validated by zod.
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

export const SCENARIO_FILE = path.join(process.cwd(), "data", "scenario.yaml");

export const CHANNELS = [
  "email_client",
  "ticket_support",
  "commentaire_in_app",
  "nps",
  "note_csm",
  "note_sales",
  "slack_interne",
] as const;
export const ITEM_TYPES = [
  "bug",
  "demande_fonctionnelle",
  "irritant_ux",
  "question",
  "eloge",
  "signal_churn",
  "autre",
] as const;
export const AREAS = [
  "taches",
  "tableau_kanban",
  "notifications",
  "permissions_partage",
  "reporting_export",
  "planification",
  "integrations",
  "facturation_temps",
  "personnalisation",
  "performance",
  "autre",
] as const;
export const PATTERN_IDS = ["S1", "S2a", "S2b", "S3", "S4", "S5a", "S5b", "S6", "S7"] as const;

export type Channel = (typeof CHANNELS)[number];
export type ItemType = (typeof ITEM_TYPES)[number];
export type Area = (typeof AREAS)[number];
export type PatternId = (typeof PATTERN_IDS)[number];

const channel = z.enum(CHANNELS);
const plan = z.enum(["free", "pro", "business", "enterprise"]);
const segment = z.enum(["agence_com", "agence_digitale", "conseil", "pme_services", "hors_cible"]);
const sentiment = z.enum(["negative", "neutral", "positive", "mixed"]);
const window = z.tuple([z.number().int().min(0), z.number().int().min(0)]);
const planWeights = z.partialRecord(plan, z.number().positive());
const count = z.number().int().positive();

const itemSchema = z.strictObject({
  type: z.enum(ITEM_TYPES),
  acceptable_types: z.array(z.enum(ITEM_TYPES)).min(1),
  area: z.enum(AREAS),
});

const patternSchema = z.strictObject({
  truth: z.string().min(10),
  volume: count,
  holdout: count,
  channels: z.partialRecord(channel, count),
  plans: planWeights.optional(),
  segments: z.array(segment).optional(),
  accounts: z.array(z.string()).optional(),
  days_ago: window,
  sentiment,
  injection: z.boolean().optional(),
  item: itemSchema,
  angles: z.array(z.string().min(3)).min(1).optional(),
  solutions: z.array(z.strictObject({ request: z.string(), count })).optional(),
  fixed: z
    .array(
      z.strictObject({
        account: z.string(),
        channel,
        churn: z.boolean(),
        brief: z.string().min(10),
      }),
    )
    .optional(),
});

const variantSchema = z.strictObject({
  brief: z.string().min(3),
  area: z.enum(AREAS),
  acceptable_areas: z.array(z.enum(AREAS)).optional(),
  account: z.boolean().optional(),
});

const noiseTopicSchema = z.strictObject({
  key: z.string().regex(/^[a-z_]+$/),
  count,
  holdout: count,
  type: z.enum(ITEM_TYPES),
  area: z.enum(AREAS).optional(),
  acceptable_areas: z.array(z.enum(AREAS)).optional(),
  sentiment: z.enum(["negative", "neutral", "positive"]),
  channels: z.array(channel).min(1),
  plans: planWeights.optional(),
  brief: z.string().min(3).optional(),
  variants: z.array(variantSchema).min(1).optional(),
  existing_feature: z.boolean().optional(),
  churn: z.boolean().optional(),
  no_account: z.boolean().optional(),
});

const comboSchema = z.strictObject({
  patterns: z.tuple([z.string(), z.string()]),
  channel,
  plan: plan.optional(),
  account: z.string().optional(),
});

export const scenarioSchema = z
  .strictObject({
    version: z.literal(1),
    window_days: count,
    seeds: z.strictObject({ development: z.number().int(), holdout: z.number().int() }),
    staff: z.strictObject({
      sales: z.array(z.string()).min(1),
      support: z.array(z.string()).min(1),
      product: z.array(z.string()).min(1),
    }),
    channels: z.record(
      channel,
      z.strictObject({
        source_type: z.enum(["client_direct", "support", "interne"]),
        lines: z.tuple([count, count]),
        subject: z.boolean(),
      }),
    ),
    styles: z.array(z.string().min(3)).min(3),
    patterns: z.record(z.enum(PATTERN_IDS), patternSchema),
    noise: z.strictObject({ window, topics: z.array(noiseTopicSchema).min(1) }),
    edge_cases: z.strictObject({
      E1: z.strictObject({ combos: z.array(comboSchema).min(1), holdout: z.number().int().min(0) }),
      E2: z.strictObject({
        relaunch: z.strictObject({ pattern: z.string(), plan, count, channels: z.array(channel) }),
        cross_channel: z.strictObject({ pattern: z.string(), plan, channels: z.array(channel) }),
      }),
      E3: z.strictObject({
        patterns: z.array(z.string()).min(1),
        holdout: z.number().int().min(0),
      }),
      E4: z.strictObject({ kinds: z.array(z.enum(["absence", "spam", "vide"])).min(1) }),
      E5: z.strictObject({ topic: z.string() }),
      E6: z.strictObject({ patterns: z.array(z.string()).min(1), min_chars: count }),
      E7: z.strictObject({
        patterns: z.array(z.string()).min(1),
        holdout: z.number().int().min(0),
      }),
      E8: z.strictObject({
        patterns: z.array(z.string()).min(1),
        holdout: z.number().int().min(0),
      }),
    }),
  })
  .superRefine((s, ctx) => {
    for (const [id, p] of Object.entries(s.patterns)) {
      const channelTotal = Object.values(p.channels).reduce((a, b) => a + b, 0);
      if (channelTotal !== p.volume) {
        ctx.addIssue({
          code: "custom",
          message: `${id}: channels sum to ${channelTotal}, volume is ${p.volume}`,
        });
      }
      if (p.fixed && p.fixed.length !== p.volume) {
        ctx.addIssue({
          code: "custom",
          message: `${id}: ${p.fixed.length} fixed feedbacks for a volume of ${p.volume}`,
        });
      }
      if (p.solutions && p.solutions.reduce((a, b) => a + b.count, 0) !== p.volume) {
        ctx.addIssue({ code: "custom", message: `${id}: solution counts must sum to the volume` });
      }
      if (!p.fixed && !p.angles)
        ctx.addIssue({ code: "custom", message: `${id}: needs angles or fixed feedbacks` });
      if (!p.item.acceptable_types.includes(p.item.type)) {
        ctx.addIssue({ code: "custom", message: `${id}: acceptable_types must include type` });
      }
      if (p.days_ago[0] > p.days_ago[1] || p.days_ago[1] >= s.window_days) {
        ctx.addIssue({ code: "custom", message: `${id}: days_ago outside the window` });
      }
    }
    for (const t of s.noise.topics) {
      if (!t.variants && (!t.area || !t.brief)) {
        ctx.addIssue({
          code: "custom",
          message: `noise ${t.key}: needs area and brief, or variants`,
        });
      }
    }
  });

export type Scenario = z.infer<typeof scenarioSchema>;
export type PatternSpec = Scenario["patterns"][PatternId];
export type NoiseTopic = Scenario["noise"]["topics"][number];

export function loadScenario(file: string = SCENARIO_FILE): Scenario {
  return scenarioSchema.parse(parseYaml(readFileSync(file, "utf8")));
}
