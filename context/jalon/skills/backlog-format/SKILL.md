---
name: backlog-format
description: À utiliser avant de transformer un insight en backlog, pour choisir la forme (epic et stories, story seule, bug, tâche technique ou action de découvrabilité) et respecter le gabarit de chaque type.
---

# Format du backlog

## Objectif

Un insight ne se traduit pas toujours en epic et en stories. Choisir la forme qui correspond au problème, la remplir au gabarit de son type, et livrer des éléments prêts pour l'équipe (Definition of Ready). Le détail de la story est dans la skill `user-story` ; les points viennent de la skill `estimation`.

## Règle de choix

Le code propose une forme à partir des faits de l'insight ; tu peux t'en écarter en le justifiant, l'écart reste visible.

| Faits de l'insight                                                              | Forme                                                                                               |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Items majoritairement `existing_feature`                                        | **Rien dans le backlog** : une action de découvrabilité (article d'aide, amélioration d'onboarding) |
| Items majoritairement de type `bug`                                             | **Un ou plusieurs Bug**, sans epic                                                                  |
| Insight manuel de nature technique (dette, prérequis)                           | **Tâche technique**                                                                                 |
| Fonctionnel, fourchette au-delà de 8 points ou plusieurs livraisons nécessaires | **Epic + 3 à 6 stories** découpées verticalement                                                    |
| Fonctionnel, fourchette de 8 points ou moins                                    | **Une story seule**, sans epic                                                                      |

L'ordre compte : on vérifie d'abord la fonctionnalité existante, puis les bugs, puis le technique, puis la taille.

## Règles

1. **Une epic n'existe que si elle regroupe plusieurs éléments.** Elle porte un titre (le résultat visé), un objectif relié à un OKR (`O2-KR1`) et un KPI mesurable.
2. **Une story seule ne reçoit pas d'epic**, un bug non plus.
3. **Un prérequis technique** découvert pendant le découpage (centraliser les contrôles de permissions avant d'ajouter un rôle) devient une tâche technique dans l'epic, listée en dépendance des stories qu'elle débloque.
4. **Points en Fibonacci** : 1, 2, 3, 5, 8 ou 13 par élément. Au-delà de 8, propose un découpage. La somme des éléments se compare à la fourchette de l'insight : un écart se dit et s'explique.
5. **Preuves** : chaque élément cite des retours (`R-042`) de l'insight ; le code vérifie qu'ils lui appartiennent.
6. **Toujours en français**, titres à l'infinitif ou au constat (bug), sans jargon interne inutile.
7. **Changement de type** (une story qui est en fait un bug) : décidé par le PO ; tu régénères l'élément entièrement au gabarit du nouveau type, sans recopier les champs de l'ancien.
8. **Relance de la rédaction sur un insight déjà traité** : l'epic et les éléments déjà envoyés dans Notion sont conservés tels quels ; seuls les brouillons sont remplacés, et seulement après confirmation du PO. Tu complètes autour de l'existant au lieu de le dupliquer.
9. **Un élément envoyé dans Notion ne se modifie plus ici** : on le modifie dans Notion.

## Definition of Ready (tous les types)

- [ ] Valeur (story) ou objectif (bug, tâche) explicite.
- [ ] Critères testables : 2 à 5 scénarios Gherkin pour une story ou un bug, dont au moins un cas limite ou d'erreur ; définition de terminé vérifiable pour une tâche.
- [ ] Estimation justifiée : points, composants touchés (`architecture.md`), ticket analogue.
- [ ] Preuves liées.
- [ ] Dépendances listées (ou « aucune »).
- [ ] Story : checklist INVEST respectée (skill `user-story`).

## Bon exemple : story dans une epic (gabarit)

```
Epic E-03 — Permettre aux agences de travailler avec leurs clients en toute sécurité
Objectif : O1-KR2, O2-KR1 · KPI : % de projets avec un invité client

US-014 — Inviter un client sur un seul projet
Afin de partager l'avancement sans exposer mes autres projets,
en tant que chef de projet en agence,
je veux inviter un client externe sur un projet précis avec un accès en lecture.

Règles de gestion
- Un invité ne voit que les projets auxquels il est invité.
- Un invité ne peut ni modifier ni commenter en lecture seule.

Critères d'acceptation
Scénario : invitation d'un client sur un projet
  Étant donné que je suis admin du projet « Refonte site Kaléo »
  Quand j'invite client@kaleo.fr avec le rôle « Invité lecture »
  Alors client@kaleo.fr reçoit une invitation
  Et il ne voit que le projet « Refonte site Kaléo »
Scénario : accès refusé à un autre projet
  Étant donné que client@kaleo.fr est invité sur « Refonte site Kaléo »
  Quand il ouvre le lien d'un autre projet de l'agence
  Alors l'accès est refusé

KPI de succès : 25 % des projets actifs avec un invité client à 90 jours
Estimation : 8 points — composants : permissions, parametres · analogue T-117 (5 pts estimés, 8 réels) · fourchette de l'epic : 21 à 34 points
Dépendances : TT-004 (centraliser les contrôles de permissions)
Preuves : R-012, R-088, R-153
```

## Bon exemple : bug (gabarit)

```
BUG-007 — Les assignations ne sont pas notifiées en mode « digest quotidien »
Sévérité : majeur · Comptes touchés : 18 dont 2 Enterprise · Insight : I-03

Comportement attendu : toute assignation déclenche un e-mail, quel que soit le mode de notification.
Comportement constaté : en mode « digest quotidien », les assignations ne partent jamais.
Étapes de reproduction : 1. activer le digest quotidien ; 2. assigner une tâche ; 3. aucun e-mail.

Critères d'acceptation
Scénario : assignation en mode digest
  Étant donné qu'un membre a activé le digest quotidien
  Quand on lui assigne une tâche
  Alors il reçoit un e-mail d'assignation immédiat
  Et l'assignation figure aussi dans son prochain digest
Scénario : assignation à plusieurs membres aux préférences différentes
  Étant donné deux membres, l'un en digest et l'autre en envoi immédiat
  Quand on leur assigne la même tâche
  Alors chacun reçoit un e-mail d'assignation

Estimation : 2 points — composant : notifications · analogue T-108 (2 pts estimés, 2 réels)
Preuves : R-031, R-102, R-266
```

Sévérité : `bloquant` (usage cœur impossible, pas de contournement), `majeur` (usage cœur dégradé), `mineur` (gêne contournable). Les comptes touchés sont calculés en code : reprends le chiffre fourni.

## Bon exemple : tâche technique (gabarit)

```
TT-002 — Virtualiser le rendu du tableau kanban
Objectif : chargement du tableau < 1 s au p75 (O3-KR2)
Définition de terminé : rendu virtualisé au-delà de 100 cartes, mesure p75 avant / après, aucune régression du glisser-déposer
Risques : glisser-déposer entre colonnes virtualisées
Estimation : 5 points — composant : tableau · analogue T-121
```

## Bon exemple : fonctionnalité existante

Insight « Je ne trouve pas comment voir les tâches d'une seule personne » (4 retours, `existing_feature` majoritaire) → rien dans le backlog. Proposition : « Le filtre par assigné existe dans la vue liste. Action proposée : un article d'aide et une info-bulle sur le bouton Filtres. Preuves : R-045, R-190. »

## Mauvais exemple commenté

```
Epic E-05 — Notifications
US-031 — En tant qu'utilisateur, je veux recevoir mes notifications, afin de recevoir mes notifications.
Estimation : 4 points
```

- Un insight fait de bugs devient un Bug, sans epic ; une epic d'un seul élément n'a pas lieu d'être.
- La story répète le « quoi » dans le « pourquoi » et ne commence pas par la valeur.
- 4 n'est pas dans la suite de Fibonacci ; ni composant, ni analogue, ni preuve, ni Gherkin.

## Erreurs fréquentes

- Faire une epic par réflexe pour un petit besoin.
- Écrire une story pour une fonctionnalité qui existe déjà.
- Inventer le nombre de comptes touchés d'un bug au lieu de reprendre celui du code.
- Découper horizontalement (« le back », « le front ») au lieu de tranches de valeur.
- Écraser des éléments déjà envoyés lors d'une relance.
