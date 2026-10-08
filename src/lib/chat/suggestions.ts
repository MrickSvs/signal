// The chat panel's three contextual suggestions and the page context sent to the
// agent with each message (SPEC §12.9). Pure.

export type ChatPageContext = { page: string; entity_id: string | null };

const ENTITY_PARAMS = ["retour", "element", "insight", "entite"] as const;
const ENTITY = /^(?:R-\d{3,}|I-\d{2,}|US-\d{3,}|BUG-\d{3,}|TT-\d{3,}|E-\d{2,}|C-\d{3,})$/;

/** /insights/I-07 → I-07 ; /retours?retour=R-042 → R-042 ; otherwise no entity. */
export function pageContext(pathname: string, search = ""): ChatPageContext {
  const fromPath = pathname.split("/").filter(Boolean).at(-1) ?? "";
  if (ENTITY.test(fromPath)) return { page: pathname, entity_id: fromPath };
  const params = new URLSearchParams(search);
  for (const key of ENTITY_PARAMS) {
    const value = params.get(key);
    if (value && ENTITY.test(value)) return { page: pathname, entity_id: value };
  }
  return { page: pathname, entity_id: null };
}

const BY_SECTION: Record<string, [string, string, string]> = {
  "/": [
    "Quoi de neuf depuis ma dernière visite ?",
    "Qu'est-ce qui mérite mon attention aujourd'hui ?",
    "Résume les alertes ouvertes.",
  ],
  "/retours": [
    "Qu'est-ce qui remonte chez les clients Enterprise ce mois-ci ?",
    "Quels retours récents signalent un risque de churn ?",
    "Quels retours restent dans la file « à surveiller » ?",
  ],
  "/insights": [
    "Quels sujets montent le plus en ce moment ?",
    "Quels insights proposés attendent ma revue ?",
    "Quels sujets touchent des comptes qui renouvellent bientôt ?",
  ],
  "/priorisation": [
    "Le classement actuel est-il robuste ?",
    "Qu'est-ce qui change si on classe par MRR ?",
    "Les Must tiennent-ils dans la capacité ?",
  ],
  "/backlog": [
    "Où en est le backlog ?",
    "Quels insights du top 5 n'ont pas encore de backlog ?",
    "Quels éléments attendent ma validation ?",
  ],
  "/evals": [
    "Que mesurent les évals de Signal ?",
    "Où Signal est-il le moins fiable ?",
    "Comment est calibré le juge ?",
  ],
  "/contexte": [
    "Quels sont les OKRs du trimestre ?",
    "Quels engagements clients sont en cours ?",
    "Quelles skills utilises-tu, et quand ?",
  ],
};

function section(pathname: string): string {
  if (pathname === "/") return "/";
  return Object.keys(BY_SECTION).find((s) => s !== "/" && pathname.startsWith(s)) ?? "/";
}

export function suggestionsFor(context: ChatPageContext): [string, string, string] {
  const id = context.entity_id;
  if (id?.startsWith("I-"))
    return [
      `Pourquoi ${id} est-il classé ici ?`,
      `Qui est concerné par ${id} ?`,
      `Prépare le backlog de ${id}.`,
    ];
  if (id?.startsWith("R-"))
    return [
      `Que dit ${id}, et à quel sujet est-il rattaché ?`,
      `D'autres comptes disent-ils la même chose que ${id} ?`,
      `Le compte de ${id} est-il à risque ?`,
    ];
  return BY_SECTION[section(context.page)];
}

/** The message « En parler à Signal » prepares from a digest recommendation (chat pre-filled). */
export function recommendationPrompt(title: string, evidence: readonly string[]): string {
  const proofs = evidence.length ? ` (preuves : ${evidence.join(", ")})` : "";
  return `Parlons de ta recommandation « ${title} »${proofs}. Qu'est-ce qui la justifie, et que dois-je trancher ?`;
}
