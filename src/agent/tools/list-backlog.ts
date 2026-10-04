import { z } from "zod";
import { LIST_LIMIT, signalTool, ToolError, type AgentDeps } from "./shared";

const BACKLOG_ID = /^(?:US|BUG|TT)-\d{3,}$/;

export function listBacklogTool(deps: AgentDeps) {
  return signalTool(
    {
      name: "list_backlog",
      summary:
        "État du backlog : epics et éléments (story, bug, tâche technique) avec type, titre, points, statut Signal et statut Notion. 10 éléments au plus, avec le total.",
      when: "Savoir ce qui existe déjà pour un insight, ou l'état d'éléments précis (US-, BUG-, TT-).",
      notWhen: "Rédiger ou modifier le backlog (rédaction du backlog, pas cet outil).",
      schema: z.object({
        insight_id: z
          .string()
          .regex(/^I-\d{2,}$/)
          .optional(),
        ids: z
          .array(z.string().regex(BACKLOG_ID, "ID attendu : US-001, BUG-001 ou TT-001"))
          .min(1)
          .max(20)
          .optional(),
        status: z.enum(["brouillon", "valide", "envoye", "modifie_notion", "rejete"]).optional(),
      }),
    },
    async (input) => {
      const { db } = deps;
      let items = db
        .from("backlog_items")
        .select(
          "id, kind, title, points, status, notion_status_raw, epic_id, insight_id, push_error",
          {
            count: "exact",
          },
        );
      if (input.insight_id) items = items.eq("insight_id", input.insight_id);
      if (input.ids) items = items.in("id", input.ids);
      if (input.status) items = items.eq("status", input.status);
      const epicQuery = input.insight_id
        ? db.from("epics").select("id, title, insight_id").eq("insight_id", input.insight_id)
        : null;
      const [rows, epics] = await Promise.all([
        items.order("id").limit(LIST_LIMIT),
        epicQuery ?? Promise.resolve({ data: [], error: null }),
      ]);
      if (rows.error) throw new Error(rows.error.message);
      if (epics.error) throw new Error(epics.error.message);
      const missing = input.ids?.filter((id) => !rows.data.some((r) => r.id === id)) ?? [];
      if (input.ids && missing.length === input.ids.length)
        throw new ToolError(`Aucun de ces éléments n'existe : ${missing.join(", ")}.`);
      return {
        total: rows.count ?? rows.data.length,
        epics: (epics.data ?? []).map((e) => ({ id: e.id, titre: e.title })),
        elements: rows.data.map((r) => ({
          id: r.id,
          type: r.kind,
          titre: r.title,
          points: r.points,
          statut: r.status,
          statut_notion: r.notion_status_raw,
          epic: r.epic_id,
          insight: r.insight_id,
          ...(r.push_error ? { erreur_envoi: r.push_error } : {}),
        })),
        ...(missing.length ? { introuvables: missing } : {}),
        ...(rows.data.length === 0 && !input.ids
          ? { note: "Aucun élément du backlog pour ces critères." }
          : {}),
      };
    },
  );
}
