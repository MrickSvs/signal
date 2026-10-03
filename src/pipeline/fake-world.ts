// Tests only: a small simulated world for the pipeline graph and the incremental mode. Nothing
// here calls an external API (CLAUDE.md rule 11): the base is in memory, the models and Voyage
// are fakes. A feedback text carries markers read by the fake triage: [topic:a] picks its topic
// (a vector direction), [churn] a churn signal, [critique] a critical urgency, [fail] an API error.
import { vi } from "vitest";
import { createMemoryDb, type MemoryTables } from "@/lib/db/memory";
import { EMPTY_USAGE } from "@/lib/llm/cost";
import type { invokeStructured } from "@/lib/llm/structured";
import type { StoredEstimate } from "@/services/estimate";

export const NOW = new Date("2026-06-01T12:00:00Z");
const DAY_MS = 24 * 3600 * 1000;
export const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY_MS).toISOString();
const inDays = (d: number) => new Date(NOW.getTime() + d * DAY_MS).toISOString().slice(0, 10);

export const TOPICS: Record<string, { dim: number; area: string }> = {
  a: { dim: 0, area: "notifications" },
  b: { dim: 1, area: "performance" },
  c: { dim: 2, area: "planification" },
  d: { dim: 3, area: "taches" },
  e: { dim: 4, area: "integrations" },
};

const hash = (text: string) => [...text].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

/** Fake Voyage: « Problème <topic> — … » → the topic direction, with a little deterministic noise. */
export function fakeEmbed(texts: string[]): Promise<number[][]> {
  return Promise.resolve(
    texts.map((text) => {
      const topic = /Problème (\w)/.exec(text)?.[1] ?? "a";
      const v = [0, 0, 0, 0, 0];
      v[TOPICS[topic].dim] = 1;
      v[(TOPICS[topic].dim + 1) % 5] = 0.02 * (hash(text) % 3);
      return v;
    }),
  );
}

let feedbackSeq = 0;

export function feedbackRow(text: string, extra: Record<string, unknown> = {}) {
  const id = `R-${String(++feedbackSeq).padStart(3, "0")}`;
  return {
    id,
    channel: "commentaire_in_app",
    source_type: "client_direct",
    author_name: null,
    author_email: null,
    customer_id: null,
    subject: null,
    raw_text: text,
    nps_score: null,
    truncated: false,
    language: null,
    ingested_run_id: null,
    received_at: daysAgo(3),
    created_at: daysAgo(1),
    ...extra,
  };
}

/** 6 feedbacks on « a » (one account, ranked), 3 on « b » (weak signal) and a praise. */
export function world(): MemoryTables {
  feedbackSeq = 0;
  const feedbacks = [
    ...Array.from({ length: 6 }, (_, i) =>
      feedbackRow(`[topic:a] notifications en retard ${i}`, {
        customer_id: "C-002",
        channel: i % 2 ? "ticket_support" : "commentaire_in_app",
        source_type: i % 2 ? "support" : "client_direct",
        received_at: daysAgo(10 + i),
      }),
    ),
    ...Array.from({ length: 3 }, (_, i) => feedbackRow(`[topic:b] lenteur ${i}`)),
    feedbackRow("[topic:a] [eloge] merci pour l'appli"),
  ];
  return {
    customers: [
      {
        id: "C-001",
        name: "Atelier Mercure",
        status: "client",
        segment: "agence_com",
        plan: "enterprise",
        mrr_eur: 4200,
        renewal_date: inDays(60),
        email_domain: "mercure.fr",
      },
      {
        id: "C-002",
        name: "Studio Pro",
        status: "client",
        segment: "agence_digitale",
        plan: "pro",
        mrr_eur: 60,
        renewal_date: null,
        email_domain: "studio-pro.fr",
      },
    ],
    feedbacks,
    feedback_analyses: [],
    feedback_items: [],
    insights: [],
    insight_items: [],
    insight_relations: [],
    overrides: [],
    backlog_items: [],
    scores: [],
    alerts: [],
    pipeline_runs: [],
    complexity_estimates: [],
    digests: [],
    po_state: [{ id: true, last_seen_at: null, last_digest_id: null }],
    decisions: [],
  };
}

export function memoryDb(tables: MemoryTables) {
  let n = 0;
  return createMemoryDb(tables, {
    defaults: {
      feedbacks: () => ({
        id: `R-${String(++feedbackSeq).padStart(3, "0")}`,
        truncated: false,
        language: null,
        ingested_run_id: null,
        received_at: NOW.toISOString(),
        created_at: new Date().toISOString(),
      }),
      feedback_items: (row) => ({
        id: `${row.feedback_id}.${row.item_index}`,
        watch: false,
        embedding: null,
      }),
      feedback_analyses: () => ({ created_at: new Date(NOW.getTime() + ++n).toISOString() }),
      insights: (_row, table) => ({
        id: `I-${String(table.length + 1).padStart(2, "0")}`,
        origin: "retours",
        status: "propose",
        title_locked: false,
        merged_into: null,
        expressed_requests: [],
        ranked: false,
        trend: {},
        mrr_exposed: 0,
        accounts_count: 0,
        renewals_90d: 0,
        created_at: new Date().toISOString(),
      }),
      insight_relations: () => ({ id: `rel-${++n}` }),
      scores: () => ({
        id: `score-${++n}`,
        created_at: new Date(NOW.getTime() + ++n).toISOString(),
      }),
      alerts: () => ({ id: `alert-${++n}`, created_at: new Date().toISOString() }),
      digests: () => ({ id: `digest-${++n}`, created_at: new Date().toISOString() }),
      pipeline_runs: () => ({ id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` }),
    },
  });
}

const text = (messages: Parameters<typeof invokeStructured>[2]) => String(messages[1].content);

/** Fake models, keyed on the generation name of each call. */
export function fakeInvoke() {
  return vi.fn(async (_role, _schema, messages, options) => {
    const body = text(messages);
    switch (options.name) {
      case "triage-feedback": {
        if (body.includes("[fail]")) throw new Error("API indisponible");
        const topic = /\[topic:(\w)\]/.exec(body)?.[1] ?? "a";
        const id = /id="(R-\d+)"/.exec(body)?.[1] ?? /(R-\d{3})/.exec(body)?.[1] ?? "R-?";
        return {
          data: {
            language: "fr",
            sentiment: -1,
            urgency: body.includes("[critique]") ? "critique" : "moyenne",
            churn_signal: body.includes("[churn]"),
            injection_suspected: false,
            confidence: 0.9,
            items: [
              {
                type: body.includes("[eloge]") ? "eloge" : "bug",
                product_area: TOPICS[topic].area,
                tags: [],
                expressed_request: null,
                underlying_problem: `Problème ${topic}`,
                summary: `Résumé ${topic} ${id}`,
                existing_feature: false,
              },
            ],
          },
          usage: EMPTY_USAGE,
        };
      }
      case "label-insight": {
        const area = /\[\w+ \/ (\w+)\]/.exec(body)?.[1] ?? "autre";
        return {
          data: {
            title: `Problème de ${area}`,
            problem_statement: `Les utilisateurs souffrent d'un problème de ${area}.`,
            product_area: area,
            expressed_requests: [],
          },
          usage: EMPTY_USAGE,
        };
      }
      case "consolidate-insights":
        return { data: { merges: [] }, usage: EMPTY_USAGE };
      case "detect-tensions":
        return { data: { tensions: [] }, usage: EMPTY_USAGE };
      case "judge-insight": {
        const evidence = /Preuves possibles \(ID de retours\) : (.*)$/m
          .exec(body)![1]
          .split(", ")
          .slice(0, 2);
        return {
          data: {
            impact: 1,
            impact_rationale: "Friction réelle.",
            impact_evidence: evidence,
            contradictory_evidence: { flag: false, reason: null },
            alignment: "neutre",
            okr_refs: [],
            alignment_rationale: "Neutre.",
            moscow_reco: "should",
            moscow_rationale: "Premier quartile.",
          },
          usage: EMPTY_USAGE,
        };
      }
      case "write-digest": {
        if (body.includes("[digest-fail]")) throw new Error("API indisponible");
        const facts = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1));
        const first = facts.feedbacks.ids[0];
        return {
          data: {
            alertes: facts.alerts.length
              ? `- Alerte ${facts.alerts[0].kind}.`
              : "Aucune alerte ouverte.",
            nouveaux_retours: first ? `Des retours, dont ${first}.` : "Aucun nouveau retour.",
            tendances: "Aucune tendance émergente.",
            comptes_a_risque: "Aucun compte à risque.",
            classement: "",
            a_trancher: "Revue en lot des sujets proposés.",
            recommandations: first
              ? [{ action: "Valider les sujets proposés", preuves: [first], confiance: "moyenne" }]
              : [],
          },
          usage: EMPTY_USAGE,
        };
      }
      default:
        throw new Error(`Appel de modèle inattendu : ${options.name}`);
    }
  }) as unknown as typeof invokeStructured & ReturnType<typeof vi.fn>;
}

export const fakeEstimateFn = vi.fn(
  async (_db: unknown, insightId: string): Promise<StoredEstimate> => ({
    id: `est-${insightId}`,
    cached: true,
    estimate: {
      components: ["notifications"],
      points_min: 3,
      points_max: 5,
      tshirt_min: "M",
      tshirt_max: "M",
      confidence: "moyenne",
      analogies: [],
      rationale: "",
      risks: [],
      model: "test",
    },
  }),
);

export const SKILLS = {
  triage: "skill triage",
  riceScoring: "skill rice",
  moscow: "skill moscow",
  digest: "skill digest",
};
