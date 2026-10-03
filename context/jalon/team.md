# Équipe produit et capacité

> Doc interne, tenue par la PO. Les chiffres de capacité alimentent `weighting.yaml` (règle des 60 %, conversions d'effort).

## Composition

| Rôle          | Effectif | Notes                                                                                |
| ------------- | -------- | ------------------------------------------------------------------------------------ |
| Product Owner | 1        | Léa. Arbitre le backlog, écrit ou valide les stories.                                |
| Développeurs  | 5        | Full-stack. Deux connaissent bien les permissions et l'export, un les notifications. |
| Designer      | 1        | Maquettes des stories, kit visuel des prototypes.                                    |
| QA            | 1        | Tests de recette, scénarios Gherkin, non-régression.                                 |

Seuls les développeurs comptent dans la capacité en semaines-personne : le design et la QA sont dimensionnés pour suivre.

## Rythme

- Sprints de **2 semaines**. Planning le premier jour, revue et rétro le dernier.
- Une release en production à chaque fin de sprint ; correctifs urgents à la demande.
- Backlog raffiné en continu : une story entre en sprint seulement si elle respecte la Definition of Ready (skill `backlog-format`).

## Vélocité

- **~30 points par sprint** pour l'équipe, stable sur les six derniers sprints.
- Soit **3 points par développeur et par semaine** (30 ÷ 5 devs ÷ 2 semaines).
- Conversion : **semaines-personne = points ÷ 3**.

## Échelle de points

Suite de Fibonacci : **1, 2, 3, 5, 8, 13, 21**. Un élément du backlog vaut au plus 13 points ; au-delà de 8, on propose un découpage. 21 est réservé aux fourchettes d'insight, jamais à un élément du backlog.

| Points | Repère                                                                    |
| ------ | ------------------------------------------------------------------------- |
| 1      | Changement de libellé, réglage, correctif trivial et localisé             |
| 2      | Petit correctif ou petite évolution dans un seul module, sans migration   |
| 3      | Évolution simple dans un module, avec tests                               |
| 5      | Évolution qui touche deux modules, ou une migration de données simple     |
| 8      | Fonctionnalité complète dans un module, ou module couplé à risque         |
| 13     | Fonctionnalité transverse, plusieurs modules dont un à couplage fort      |
| 21     | Chantier : nouveau concept dans le modèle de données (invité, dépendance) |

**Taille T-shirt** (dérivée des points, pour parler aux non-développeurs) : **S** < 3 points ; **M** < 8 ; **L** < 20 ; **XL** ≥ 20.

## Biais connus de l'équipe

Constatés en rétro et mesurés sur les tickets livrés (le calcul exact est fait en code à partir de l'historique) :

- Les **permissions** et l'**export** sont régulièrement sous-estimés : contrôles dispersés, cas oubliés en recette.
- Les correctifs de **notifications** sont bien estimés.
- Les autres modules ont un écart modéré.

## Capacité du trimestre

- 5 développeurs × 12 semaines utiles = **60 semaines-personne**.
- **70 % pour la roadmap = 42 semaines-personne** (~126 points). Les 30 % restants couvrent le support, les correctifs non planifiés, la dette courante et les congés.
- Règle DSDM : l'effort cumulé des **Must** ne dépasse pas **60 %** de la capacité roadmap, soit **~25 semaines-personne** (~75 points). Au-delà, on rétrograde.
