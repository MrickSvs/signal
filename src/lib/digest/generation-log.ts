// What the Digest screen says while a digest is being written (ADR-044): the steps streamed by
// POST /api/digest, turned into log lines. Pure, so the wording is tested once for both screens.
import { formatCost, formatDateTime, formatNumber } from "@/lib/format";
import { modelFamily } from "@/lib/labels";
import type { DigestStreamEvent } from "@/lib/digest/stream";

export type LogTone = "done" | "active" | "warning" | "error";

export type LogLine = {
  key: "connect" | "period" | "facts" | "memory" | "writing" | "saved" | "done" | "error";
  tone: LogTone;
  /** Milliseconds since the click, when the step ended (null while it runs). */
  at: number | null;
  title: string;
  /** Figures read by the step, shown as chips; only the non-zero ones. */
  figures: { value: number; label: string }[];
  detail?: string;
};

/** Steps of a generation, in order: the rail shows how far it is. */
export const GENERATION_STEPS = ["period", "facts", "memory", "writing", "saved"] as const;

const plural = (n: number, one: string, many: string) => (n > 1 ? many : one);

function figure(value: number, one: string, many: string) {
  return { value, label: plural(value, one, many) };
}

/**
 * Log lines from the events received so far. The step under way is the last line, « active »:
 * before any event, Signal is connecting (context, lock); after « writing », the model writes.
 */
export function buildGenerationLog(
  events: readonly DigestStreamEvent[],
  options: { first: boolean },
): LogLine[] {
  const lines: LogLine[] = [];
  let finished = false;
  for (const item of events) {
    if (item.type === "error") {
      lines.push({ key: "error", tone: "error", at: null, title: item.message, figures: [] });
      finished = true;
      continue;
    }
    if (item.type === "done") {
      const { writer, durationMs, costEur } = item.result;
      lines.push({
        key: "done",
        tone: writer === "repli" ? "warning" : "done",
        at: durationMs,
        title: options.first ? "Ton premier digest est prêt" : "Ton digest est à jour",
        figures: [],
        detail: `${formatNumber(durationMs / 1000, 0)} s · ${formatCost(costEur)}`,
      });
      finished = true;
      continue;
    }
    const { event, at } = item;
    switch (event.step) {
      case "period":
        lines.push({
          key: "period",
          tone: "done",
          at,
          title:
            event.first || event.start === null
              ? "Premier digest : tout est nouveau"
              : `Période relue depuis le ${formatDateTime(event.start)}`,
          figures: [],
        });
        break;
      case "facts": {
        const figures = [
          figure(event.feedbacks, "retour", "retours"),
          figure(event.alerts, "alerte", "alertes"),
          figure(event.emerging, "sujet émergent", "sujets émergents"),
          figure(event.newInsights, "nouvel insight", "nouveaux insights"),
          figure(event.moves, "mouvement de rang", "mouvements de rang"),
          figure(event.accountsAtRisk, "compte à risque", "comptes à risque"),
          figure(event.pending, "décision en attente", "décisions en attente"),
        ].filter((f) => f.value > 0);
        lines.push({
          key: "facts",
          tone: "done",
          at,
          title: figures.length ? "Faits relus dans la base" : "Rien de neuf sur la période",
          figures,
          detail:
            event.channels > 1
              ? `Retours venus de ${event.channels} canaux`
              : event.channels === 1
                ? "Retours venus d'un seul canal"
                : undefined,
        });
        break;
      }
      case "memory":
        lines.push({
          key: "memory",
          tone: "done",
          at,
          title: event.handled
            ? `${event.handled} ${plural(event.handled, "recommandation déjà traitée", "recommandations déjà traitées")} : pas reproposée${event.handled > 1 ? "s" : ""} sans fait nouveau`
            : "Aucune recommandation déjà traitée à écarter",
          figures: [],
        });
        break;
      case "writing":
        lines.push({
          key: "writing",
          tone: "active",
          at: null,
          title: `${modelFamily(event.model) ?? event.model} rédige le digest`,
          figures: [],
          detail: "Chaque chiffre vient des faits, chaque ID est vérifié en code",
        });
        break;
      case "written": {
        const writing = lines.find((l) => l.key === "writing");
        const line: LogLine =
          event.writer === "modele"
            ? {
                key: "writing",
                tone: "done",
                at,
                title: event.recommendations
                  ? `Rédaction vérifiée : ${event.recommendations} ${plural(event.recommendations, "recommandation", "recommandations")}`
                  : "Rédaction vérifiée : aucune recommandation nouvelle",
                figures: [],
                detail: "IDs et chiffres contrôlés en code",
              }
            : {
                key: "writing",
                tone: "warning",
                at,
                title: "Rédaction en échec : les faits sont rendus tels quels",
                figures: [],
              };
        if (writing) Object.assign(writing, line);
        else lines.push(line);
        break;
      }
      case "saved":
        lines.push({ key: "saved", tone: "done", at, title: "Digest enregistré", figures: [] });
        break;
    }
  }
  if (!finished && !lines.some((l) => l.tone === "active")) {
    lines.push({
      key: "connect",
      tone: "active",
      at: null,
      title: lines.length
        ? "Enregistrement du digest"
        : "Signal ouvre la base et charge ses règles",
      figures: [],
    });
  }
  return lines;
}

/** How many steps of GENERATION_STEPS are over (the rail's progress). */
export function stepsDone(lines: readonly LogLine[]): number {
  return GENERATION_STEPS.filter((step) => lines.some((l) => l.key === step && l.tone !== "active"))
    .length;
}
