---
name: estimation
description: À utiliser pour estimer la complexité d'un besoin, d'un insight ou des éléments d'un backlog par analogie, à partir de la carte d'architecture et des tickets de référence fournis.
---

# Estimation par analogie

## Objectif

Estimer comme une équipe produit qui connaît son système : on identifie les modules touchés sur la carte d'architecture, on compare à ce qu'on a déjà livré, et on rend une **fourchette honnête** avec un niveau de confiance. On ne lit pas de code. Le code fait les calculs : correction du biais de l'équipe, élargissement de la fourchette, conversion en semaines et en T-shirt.

## Ce que tu reçois

- Le besoin (énoncé du problème de l'insight, ou description libre).
- `architecture.md` : modules (identifiants), couplage, dépendances, dette et zones à risque.
- Les **3 tickets de référence les plus proches** (ID `T-1xx`, titre, description, composants, points estimés, points réels, surprises) avec leur similarité, et l'indication **proche / pas proche** calculée en code.
- Les **facteurs de biais** de l'équipe par composant, calculés en code (points réels ÷ points estimés), pour information.

## Règles

1. **Composants : uniquement des identifiants d'`architecture.md`** (`permissions`, `notifications`…). Le code rejette tout autre nom. Liste tous les modules touchés, y compris ceux qu'on modifie par ricochet (dépendances).
2. **Lis le couplage et les zones à risque.** Un module à couplage fort ou une zone à risque traversée (contrôles de permissions dispersés, kanban non virtualisé, préférence digest, absence d'invité, de date de début ou de dépendance) monte la fourchette et doit apparaître dans les risques.
3. **Analogues : cite seulement les tickets fournis**, avec la raison de l'analogie (« même module, même nature de changement »). Le code rejette un ID qui ne fait pas partie des tickets fournis. Raisonne sur les **points réels** de l'analogue, pas sur ses points estimés.
4. **Ne corrige pas le biais toi-même.** Rends la fourchette **brute**, telle que tu l'estimes ; le code applique le facteur de biais. Tu peux citer le biais dans la justification (« les permissions sont historiquement sous-estimées »), jamais le multiplier.
5. **Fourchette en Fibonacci** : `points_min` et `points_max` dans 1, 2, 3, 5, 8, 13, 21. L'écart reflète l'incertitude : un correctif connu tient en un cran (2 à 3), un chantier en traverse plusieurs (13 à 21).
6. **Confiance** : `haute` si un analogue proche couvre le même module et la même nature de changement ; `moyenne` si les analogues sont partiels ; `basse` si aucun analogue n'est proche ou si un nouveau concept entre dans le modèle de données.
7. **Sans analogue proche** : dis-le dans la justification, mets la confiance à `basse`. Le code élargit la fourchette et force la confiance basse de toute façon : ne compense pas en gonflant toi-même.
8. **Risques** : 1 à 4 risques concrets, chacun relié à un module ou à une zone à risque.
9. **Aucun chiffre calculé** : pas de semaines, pas de jours, pas de moyenne. Les points et la fourchette sont tes seules valeurs.

## Correspondance complexité → points

| Points | Repère (`team.md`)                                                        |
| ------ | ------------------------------------------------------------------------- |
| 1      | Changement de libellé, réglage, correctif trivial et localisé             |
| 2      | Petit correctif ou petite évolution dans un seul module, sans migration   |
| 3      | Évolution simple dans un module, avec tests                               |
| 5      | Évolution qui touche deux modules, ou une migration de données simple     |
| 8      | Fonctionnalité complète dans un module, ou module couplé à risque         |
| 13     | Fonctionnalité transverse, plusieurs modules dont un à couplage fort      |
| 21     | Chantier : nouveau concept dans le modèle de données (invité, dépendance) |

## Plusieurs éléments du backlog en une passe

Quand on te donne les éléments d'un backlog (stories, bugs, tâches) avec la fourchette de l'insight :

- Une valeur Fibonacci **par élément** (1 à 13), chacune justifiée par ses composants et un analogue.
- Chaque valeur reste **dans la fourchette de l'insight** pour un élément seul ; pour une epic, c'est la **somme** qui se compare à la fourchette : si elle en sort, dis pourquoi (un prérequis découvert, une story hors périmètre).
- Estime les éléments les uns par rapport aux autres : une story deux fois plus large qu'une autre ne vaut pas le même nombre de points.
- Au-delà de 8 points, signale qu'il faut découper.

## Sortie (insight ou besoin)

```json
{
  "components": ["permissions", "parametres"],
  "points_min": 13,
  "points_max": 21,
  "confidence": "moyenne",
  "analogies": [
    { "ticket_id": "T-117", "raison": "Ajout d'un rôle : mêmes points de contrôle dispersés." }
  ],
  "rationale": "…",
  "risks": [
    "Contrôles de permissions dispersés dans 5 écrans et l'export : chacun à reprendre et retester."
  ]
}
```

## Bon exemple

Besoin : « Permettre d'inviter un client sur un seul projet, en lecture ». Analogues fournis : T-117 (proche, ajout d'un rôle, 5 estimés, 8 réels), T-112 (proche, contrôle d'accès à l'export).

```json
{
  "components": ["permissions", "parametres", "export", "taches"],
  "points_min": 13,
  "points_max": 21,
  "confidence": "moyenne",
  "analogies": [
    {
      "ticket_id": "T-117",
      "raison": "Ajout d'un rôle : a demandé de reprendre chaque point de contrôle (8 points réels)."
    },
    { "ticket_id": "T-112", "raison": "L'export a son propre contrôle d'accès, à adapter aussi." }
  ],
  "rationale": "Nouveau concept (l'invité) dans un module à couplage fort, sans couche d'autorisation centrale. T-117 couvrait un seul rôle interne ; ici il faut un utilisateur externe et un périmètre par projet, d'où une fourchette au-dessus. Les permissions sont historiquement sous-estimées.",
  "risks": [
    "Contrôles dispersés dans 5 écrans et l'export : un oubli expose un projet à un invité.",
    "Migration des membres existants vers un modèle de rôle par projet."
  ]
}
```

## Mauvais exemple commenté

```json
{
  "components": ["Gestion des accès", "Backend"],
  "points_min": 6,
  "points_max": 10,
  "confidence": "haute",
  "analogies": [{ "ticket_id": "T-150", "raison": "Similaire." }],
  "rationale": "Environ 3 semaines de travail, plus 30 % pour le biais de l'équipe.",
  "risks": []
}
```

- Composants inventés : ce ne sont pas des identifiants d'`architecture.md`.
- 6 et 10 ne sont pas dans la suite de Fibonacci.
- T-150 n'a pas été fourni ; « similaire » n'est pas une raison.
- Semaines et correction de biais calculées par le modèle : interdit.
- Confiance haute sur un nouveau concept, sans aucun risque cité.

## Erreurs fréquentes

- Recopier les points estimés de l'analogue au lieu de ses points réels.
- Oublier les modules touchés par ricochet (l'export dépend des permissions).
- Une fourchette étroite pour un besoin flou : l'incertitude doit se voir.
- Gonfler la fourchette faute d'analogue : c'est le rôle du code.
- Estimer un Gantt comme une simple vue : il exige une date de début et des dépendances, absentes du modèle.
