# Pack de contexte de Jalon

Tout ce que Signal sait du produit, hors du code. Le pipeline et l'agent lisent ces fichiers ; aucune règle métier n'est recopiée dans un prompt ou dans le code (SPEC §6.4, ADR 008). Changer de pack, c'est changer de produit.

## Contenu

| Fichier           | Rôle                                                                                    | Lu par                                   |
| ----------------- | --------------------------------------------------------------------------------------- | ---------------------------------------- |
| `product.md`      | Le produit en une page, ses modules et la **liste des fonctionnalités existantes**      | triage (fonctionnalité existante), agent |
| `strategy.md`     | Vision, cibles et non-cibles, OKRs (`O1-KR1`…), paris                                   | alignement, MoSCoW, digest, agent        |
| `personas.md`     | Les 4 personas                                                                          | rédaction du backlog                     |
| `team.md`         | Équipe, vélocité, échelle de points, capacité                                           | estimation, MoSCoW (capacité)            |
| `architecture.md` | Modules, couplage, dépendances, dette et zones à risque                                 | estimation par analogie, backlog         |
| `commitments.md`  | Engagements contractuels (domaine couvert, échéance en J+) et comptes sensibles         | classement, MoSCoW, alertes, agent       |
| `glossary.md`     | Les termes métier                                                                       | tous les prompts qui en ont besoin       |
| `weighting.yaml`  | Tous les paramètres et seuils (Reach, Confidence, effort, MoSCoW, clustering, alertes…) | code uniquement (`src/lib/context.ts`)   |
| `skills/`         | Les savoir-faire métier, un `SKILL.md` par skill                                        | pipeline et agent                        |
| `prototype-kit/`  | Le kit visuel des prototypes                                                            | génération de prototype                  |

`src/lib/context.ts` charge le pack (`loadContextPack()`) et le valide : un `weighting.yaml` mal formé, une clé inconnue ou un tableau de modules invalide dans `architecture.md` font échouer le chargement avec un message clair.

## Règles d'écriture

- **Français**, ton de documentation interne. Moins de 150 lignes par fichier.
- **Aucune date absolue ni jour de la semaine** : tout est relatif à `DEMO_NOW` (J+45, « le trimestre en cours »).
- **Des faits, pas des calculs** : le pack donne les paramètres, le code calcule (P5).
- Les **identifiants de modules** du tableau « Modules » d'`architecture.md` sont des clés : ils servent de composants aux tickets de référence. Les renommer impose de régénérer les tickets.

## Adapter Signal à un autre produit

1. **Copier le pack** dans `context/<produit>/` et réécrire les fichiers markdown : produit et fonctionnalités existantes, stratégie et OKRs, personas, équipe, carte d'architecture, engagements.
2. **Régler `weighting.yaml`** : facteurs d'extrapolation des plans, poids des sources, capacité de l'équipe, seuils. Les noms de plans et de règles MoSCoW sont contrôlés par le schéma zod ; changer de plans demande d'adapter ce schéma.
3. **Relire les skills** (`skills/`) : enums du triage, gabarits du backlog, échelle d'Impact. Puis régénérer les tickets de référence et relancer les evals pour mesurer l'effet.
