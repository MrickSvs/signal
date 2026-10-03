import "server-only";
import type { Db } from "@/lib/db/client";
import type { Tables } from "@/lib/db/types";

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
  "id" | "kind" | "status" | "insight_id" | "feedback_ids" | "dossier_status" | "created_at"
> & { insight_title: string | null };

/** Alerts still waiting for the PO (SPEC §10.10), newest first. */
export async function listOpenAlerts(db: Db): Promise<OpenAlert[]> {
  const { data, error } = await db
    .from("alerts")
    .select(
      "id, kind, status, insight_id, feedback_ids, dossier_status, created_at, insights(title)",
    )
    .in("status", ["nouvelle", "vue"])
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`Lecture des alertes (${error.message})`);
  return data.map(({ insights, ...alert }) => ({
    ...alert,
    insight_title: insights?.title ?? null,
  }));
}
