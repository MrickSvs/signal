import "server-only";
import type { Db } from "@/lib/db/client";
import type { Tables } from "@/lib/db/types";
import { DOSSIER_ACTIONS, type DossierAction } from "@/lib/alerts";

export type LastRun = Pick<
  Tables<"pipeline_runs">,
  "id" | "kind" | "status" | "started_at" | "ended_at"
>;

/** Latest pipeline run (full or incremental) for the header, null before the first run. */
export async function getLastPipelineRun(db: Db): Promise<LastRun | null> {
  const { data, error } = await db
    .from("pipeline_runs")
    .select("id, kind, status, started_at, ended_at")
    .in("kind", ["full", "incremental"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Lecture du dernier run (${error.message})`);
  return data;
}

export type OpenAlert = Pick<
  Tables<"alerts">,
  | "id"
  | "kind"
  | "status"
  | "insight_id"
  | "feedback_ids"
  | "dossier_status"
  | "dossier_markdown"
  | "cost_eur"
  | "langfuse_url"
  | "created_at"
> & {
  insight_title: string | null;
  /** From the dossier: its title, confidence and the proposed action (closed list). */
  titre: string | null;
  confiance: string | null;
  action: { type: DossierAction; cible: string | null } | null;
};

/** The parts of a stored dossier the cards show (jsonb written by the investigation). */
export function dossierSummary(
  dossier: unknown,
): Pick<OpenAlert, "titre" | "confiance" | "action"> {
  const d = (dossier ?? {}) as {
    titre?: unknown;
    confiance?: unknown;
    action?: { type?: unknown; cible?: unknown };
  };
  const type = d.action?.type;
  return {
    titre: typeof d.titre === "string" ? d.titre : null,
    confiance: typeof d.confiance === "string" ? d.confiance : null,
    action:
      typeof type === "string" && (DOSSIER_ACTIONS as readonly string[]).includes(type)
        ? {
            type: type as DossierAction,
            cible: typeof d.action?.cible === "string" ? d.action.cible : null,
          }
        : null,
  };
}

/** Alerts still waiting for the PO (SPEC §10.10), newest first, with their dossier. */
export async function listOpenAlerts(db: Db): Promise<OpenAlert[]> {
  const { data, error } = await db
    .from("alerts")
    .select(
      "id, kind, status, insight_id, feedback_ids, dossier_status, dossier, dossier_markdown, cost_eur, langfuse_url, created_at, insights(title)",
    )
    .in("status", ["nouvelle", "vue"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Lecture des alertes (${error.message})`);
  return data.map(({ insights, dossier, ...alert }) => ({
    ...alert,
    insight_title: insights?.title ?? null,
    ...dossierSummary(dossier),
  }));
}
