// « Pourquoi ce classement » (SPEC §12.3): the classification of an item explained from what the
// pipeline stored (triage fields, grouping, similarity), composed in code. The triage stores no
// free-text rationale, and asking a model to explain afterwards would invent one.
import type { Tables } from "@/lib/db/types";
import { formatNumber } from "@/lib/format";
import { ITEM_TYPE_LABELS, PRODUCT_AREA_LABELS } from "@/lib/labels";
import { isClusterable } from "@/pipeline/nodes/embed";

export type WhyItem = Pick<
  Tables<"feedback_items">,
  | "type"
  | "product_area"
  | "expressed_request"
  | "underlying_problem"
  | "existing_feature"
  | "watch"
>;

export type WhyInsight = {
  id: string;
  status: Tables<"insights">["status"];
  similarity: number | null;
  is_representative: boolean;
};

export type WhyOptions = {
  /** Cosine distance threshold of the grouping (weighting.yaml clustering.distance_threshold). */
  distanceThreshold: number;
  /** Smallest group that forms an insight (clustering.min_cluster_size). */
  minClusterSize: number;
  /** Close watched items that form a proposed insight (clustering.watch_queue_min_items). */
  watchMinItems: number;
};

const similarity = (value: number) => formatNumber(value, 2);

export function explainItem(
  item: WhyItem,
  insights: readonly WhyInsight[],
  options: WhyOptions,
): string[] {
  const lines = [
    `Classé « ${ITEM_TYPE_LABELS[item.type]} » dans le domaine « ${PRODUCT_AREA_LABELS[item.product_area]} ».`,
  ];
  if (item.expressed_request) {
    lines.push(
      `Demande exprimée : « ${item.expressed_request} ». Le regroupement se fait sur le problème sous-jacent : « ${item.underlying_problem} ».`,
    );
  } else {
    lines.push(`Problème sous-jacent : « ${item.underlying_problem} ».`);
  }
  if (item.existing_feature) {
    // CL-05: a discoverability issue, not a story.
    lines.push(
      "La fonctionnalité existe déjà dans Jalon : c'est un besoin de découvrabilité, pas une story.",
    );
  }
  if (!isClusterable(item)) {
    lines.push(
      `Un item « ${ITEM_TYPE_LABELS[item.type]} » ne porte pas de problème à regrouper : il n'entre dans aucun insight.`,
    );
    return lines;
  }
  const threshold = similarity(1 - options.distanceThreshold);
  for (const insight of insights) {
    const measure =
      insight.similarity !== null
        ? ` : similarité ${similarity(insight.similarity)} avec ses items (seuil ${threshold})`
        : "";
    lines.push(
      `Rattaché à ${insight.id}${insight.status === "rejete" ? " (insight rejeté par le PO)" : ""}${measure}.${insight.is_representative ? " Retour représentatif de l'insight." : ""}`,
    );
  }
  if (insights.length === 0) {
    lines.push(
      item.watch
        ? `Trop éloigné de tout insight connu (seuil ${threshold}) : en file « à surveiller ». Un nouveau sujet se forme dès ${options.watchMinItems} items proches.`
        : `Aucun insight ouvert : l'item reste isolé tant que moins de ${options.minClusterSize} items proches partagent ce problème.`,
    );
  }
  return lines;
}
