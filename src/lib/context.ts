// Loads the product context pack (SPEC §6.4): markdown documents, the architecture map
// and weighting.yaml, validated by zod so that a bad edit fails loudly at load time.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { Constants } from "@/lib/db/types";

export const DEFAULT_CONTEXT_DIR = path.join(process.cwd(), "context", "jalon");

export const CONTEXT_DOCUMENTS = [
  "product",
  "strategy",
  "personas",
  "team",
  "architecture",
  "commitments",
  "glossary",
] as const;

export type ContextDocument = (typeof CONTEXT_DOCUMENTS)[number];

const plans = z.enum(["free", "pro", "business", "enterprise"]);
const share = z.number().gt(0).lte(1);
const positive = z.number().positive();
const positiveInt = z.number().int().positive();

const descending = (values: number[]) => values.every((v, i) => i === 0 || v < values[i - 1]);
const ascending = (values: number[]) => values.every((v, i) => i === 0 || v > values[i - 1]);

export const MOSCOW_RULES = [
  "engagement_contractuel",
  "hors_strategie",
  "signal_churn",
  "bug_critique",
  "quartiles",
] as const;

export const weightingSchema = z.strictObject({
  version: z.literal(1),
  reach: z.strictObject({
    default_mode: z.enum(["comptes", "mrr"]),
    extrapolation_factors: z.strictObject({
      free: positive,
      pro: positive,
      business: positive,
      enterprise: positive,
    }),
    unidentified_account: z.strictObject({
      comptes: z.number().nonnegative(),
      mrr: z.number().nonnegative(),
    }),
    prospect_weight: z.number().nonnegative(),
  }),
  source_weights: z.strictObject({
    client_direct: share,
    support: share,
    interne: share,
  }),
  confidence: z.strictObject({
    weights: z
      .strictObject({ volume: share, diversity: share, quality: share })
      .refine((w) => Math.abs(w.volume + w.diversity + w.quality - 1) < 1e-9, {
        message: "Confidence weights must sum to 1",
      }),
    volume_saturation: positiveInt,
    diversity_saturation: positiveInt,
    levels: z
      .array(z.strictObject({ min: z.number().min(0).max(1), value: share }))
      .min(2)
      .refine((levels) => descending(levels.map((l) => l.min)), {
        message: "Confidence levels must be sorted by decreasing min",
      })
      .refine((levels) => descending(levels.map((l) => l.value)), {
        message: "Confidence level values must decrease",
      })
      .refine((levels) => levels.at(-1)?.min === 0, {
        message: "The last confidence level must start at 0",
      }),
    contradiction_downgrade: z.number().int().nonnegative(),
  }),
  impact: z.strictObject({
    scale: z
      .array(positive)
      .min(2)
      .refine(descending, { message: "Impact scale must be decreasing" }),
  }),
  effort: z.strictObject({
    velocity_points_per_dev_week: positive,
    fibonacci: z
      .array(positiveInt)
      .min(3)
      .refine(ascending, { message: "Fibonacci scale must be increasing" }),
    tshirt_upper_bounds: z
      .strictObject({ S: positive, M: positive, L: positive })
      .refine((t) => t.S < t.M && t.M < t.L, { message: "T-shirt bounds must be S < M < L" }),
    default_range_multiplier: z.number().gt(1),
  }),
  estimation: z.strictObject({
    analogues_count: positiveInt,
    close_analogue_min_similarity: share,
    no_close_analogue_range_factor: z.number().gt(1),
    bias_min_tickets: positiveInt,
  }),
  trend: z
    .strictObject({
      history_weeks: positiveInt,
      recent_days: positiveInt,
      baseline_days: positiveInt,
      denominator_floor: positive,
      emerging_min_growth: positive,
      emerging_min_recent_feedbacks: positiveInt,
      new_max_age_days: positiveInt,
    })
    .refine((t) => t.recent_days + t.baseline_days <= t.history_weeks * 7, {
      message: "Trend windows must fit in the history",
    }),
  ranking: z.strictObject({
    min_feedbacks: positiveInt,
    churn_plans: z.array(plans).min(1),
    tie_breakers: z.array(z.enum(["mrr_exposed", "accounts_count", "id"])).min(1),
  }),
  robustness: z.strictObject({
    top_n: positiveInt,
    reach_degradation: z.number().gt(0).lt(1),
    rank_shift_tolerance: z.number().int().nonnegative(),
    sensible_max_moves: z.number().int().nonnegative(),
  }),
  overrides: z.strictObject({ context_changed_share: share }),
  capacity: z.strictObject({
    developers: positiveInt,
    quarter_weeks: positiveInt,
    roadmap_share: share,
  }),
  moscow: z.strictObject({
    horizon_days: positiveInt,
    rule_order: z
      .array(z.enum(MOSCOW_RULES))
      .refine(
        (order) => order.length === MOSCOW_RULES.length && new Set(order).size === order.length,
        {
          message: "rule_order must list each MoSCoW rule exactly once",
        },
      ),
    must_churn_min_impact: positive,
    must_churn_plans: z.array(plans).min(1),
    must_critical_bug_min_feedbacks: positiveInt,
    should_quartile: z.number().int().min(1).max(4),
    wont_confidence: share,
    must_capacity_share: share,
  }),
  triage: z.strictObject({
    truncation_chars: positiveInt,
    max_items_per_feedback: positiveInt,
  }),
  clustering: z.strictObject({
    distance_threshold: z.number().gt(0).lt(2),
    min_cluster_size: positiveInt,
    run_matching_jaccard: share,
    run_matching_centroid_similarity: share,
    watch_queue_min_items: positiveInt,
  }),
  alerts: z.strictObject({
    dedup_window_hours: positiveInt,
    churn_plans: z.array(plans).min(1),
    churn_renewal_max_days: positiveInt,
    critical_bug_min_feedbacks: positiveInt,
    critical_bug_window_hours: positiveInt,
    investigation_max_tool_calls: positiveInt,
    investigation_max_cost_eur: positive,
  }),
});

export type Weighting = z.infer<typeof weightingSchema>;

export const COUPLING_LEVELS = ["faible", "moyen", "fort"] as const;

const architectureModuleSchema = z.object({
  id: z.string().regex(/^[a-z_]+$/),
  name: z.string().min(1),
  coupling: z.enum(COUPLING_LEVELS),
});

export type ArchitectureModule = z.infer<typeof architectureModuleSchema>;

const commitmentSchema = z.object({
  account: z.string().min(1),
  engagement: z.string().min(1),
  product_areas: z.array(z.enum(Constants.public.Enums.product_area)).min(1),
  /** Days from DEMO_NOW (J+75 → 75). */
  due_in_days: z.number().int(),
  status: z.string().min(1),
});

export type Commitment = z.infer<typeof commitmentSchema>;

export type ContextPack = {
  dir: string;
  documents: Record<ContextDocument, string>;
  weighting: Weighting;
  /** Module ids are the component names used by reference_tickets.components. */
  modules: ArchitectureModule[];
  /** Contractual commitments of commitments.md: which product areas they cover, and when. */
  commitments: Commitment[];
};

export class ContextPackError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ContextPackError";
  }
}

// Rows of the "Modules" table: | `id` | Nom | couplage |
const MODULE_ROW = /^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/;

/** Extracts the module table of architecture.md (id, name, coupling). */
export function parseArchitectureModules(markdown: string): ArchitectureModule[] {
  const section = markdown.split(/^## /m).find((s) => s.startsWith("Modules"));
  if (!section) throw new ContextPackError("architecture.md: missing « ## Modules » section");

  const modules = section
    .split("\n")
    .map((line) => MODULE_ROW.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, id, name, coupling]) => {
      const parsed = architectureModuleSchema.safeParse({ id, name, coupling });
      if (!parsed.success) {
        throw new ContextPackError(`architecture.md: invalid module row « ${id} »`, {
          cause: parsed.error,
        });
      }
      return parsed.data;
    });

  if (modules.length === 0) throw new ContextPackError("architecture.md: no module found");
  const ids = modules.map((m) => m.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) throw new ContextPackError(`architecture.md: duplicate module « ${duplicate} »`);
  return modules;
}

// Rows of the "Engagements contractuels" table: | Compte | Engagement | `area`, `area` | J+75 | Statut |
const COMMITMENT_ROW = /^\|([^|]+)\|([^|]+)\|([^|]+)\|\s*J([+-]\d+)\s*\|([^|]+)\|$/;

/** Extracts the contractual commitments of commitments.md (account, areas, due date in J+). */
export function parseCommitments(markdown: string): Commitment[] {
  const section = markdown.split(/^## /m).find((s) => s.startsWith("Engagements contractuels"));
  if (!section) {
    throw new ContextPackError("commitments.md: missing « ## Engagements contractuels » section");
  }
  return section
    .split("\n")
    .map((line) => COMMITMENT_ROW.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map(([, account, engagement, areas, due, status]) => {
      const parsed = commitmentSchema.safeParse({
        account: account.trim(),
        engagement: engagement.replaceAll("**", "").trim(),
        product_areas: [...areas.matchAll(/`([^`]+)`/g)].map((m) => m[1]),
        due_in_days: Number(due),
        status: status.trim(),
      });
      if (!parsed.success) {
        throw new ContextPackError(`commitments.md: invalid commitment row « ${account.trim()} »`, {
          cause: parsed.error,
        });
      }
      return parsed.data;
    });
}

export function parseWeighting(source: string): Weighting {
  let raw: unknown;
  try {
    raw = parseYaml(source);
  } catch (error) {
    throw new ContextPackError("weighting.yaml: invalid YAML", { cause: error });
  }
  const parsed = weightingSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ContextPackError(`weighting.yaml: ${z.prettifyError(parsed.error)}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

async function readPackFile(dir: string, name: string): Promise<string> {
  try {
    return await readFile(path.join(dir, name), "utf8");
  } catch (error) {
    throw new ContextPackError(`Context pack: cannot read ${name} in ${dir}`, { cause: error });
  }
}

export async function loadContextPack(dir: string = DEFAULT_CONTEXT_DIR): Promise<ContextPack> {
  // Read in parallel, but report the first failure in file order: the error is deterministic.
  const results = await Promise.allSettled([
    readPackFile(dir, "weighting.yaml"),
    ...CONTEXT_DOCUMENTS.map((doc) => readPackFile(dir, `${doc}.md`)),
  ]);
  const failed = results.find((r) => r.status === "rejected");
  if (failed) throw failed.reason;
  const [weightingSource, ...contents] = results.map(
    (r) => (r as PromiseFulfilledResult<string>).value,
  );
  const documents = Object.fromEntries(
    CONTEXT_DOCUMENTS.map((doc, i) => [doc, contents[i]]),
  ) as Record<ContextDocument, string>;

  return {
    dir,
    documents,
    weighting: parseWeighting(weightingSource),
    modules: parseArchitectureModules(documents.architecture),
    commitments: parseCommitments(documents.commitments),
  };
}
