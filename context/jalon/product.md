# Jalon — le produit en une page

> Doc interne produit. Source : équipe produit. À tenir à jour à chaque release qui change un module.

## Proposition de valeur

**Piloter les projets et embarquer ses clients.** Jalon est un outil de gestion de projet pensé pour les agences (communication, digital, conseil) et les PME de services. On vend de la clarté : qui fait quoi, pour quand, et où en est le projet, sans la lourdeur d'un outil d'entreprise.

Ce qui nous distingue aujourd'hui : la prise en main en une heure, une vue kanban et une vue liste propres, un prix lisible par membre. Ce qui nous manque pour tenir la promesse « embarquer ses clients » : le client final n'a encore aucune place dans Jalon (voir les limites ci-dessous et `strategy.md`).

## Plans

| Plan       | Prix                              | Pour qui                                                     |
| ---------- | --------------------------------- | ------------------------------------------------------------ |
| Free       | 0 € (3 membres au plus)           | Freelances, très petites équipes                             |
| Pro        | 12 € / membre / mois              | Petites agences, ~5 membres                                  |
| Business   | 24 € / membre / mois              | Agences établies, ~12 membres, CSM                           |
| Enterprise | sur devis (~30 € / membre / mois) | Groupes et réseaux d'agences, 80 à 300 membres, CSM, contrat |

## Modules

Les identifiants entre crochets sont ceux de `architecture.md` (et des composants des tickets de référence).

| Module                                        | État actuel                                        | Limites connues                                                                            |
| --------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Tâches `[taches]`                             | CRUD, statuts, assignation, échéances              | —                                                                                          |
| Tableau (kanban) `[tableau]`                  | Vue kanban par projet                              | Rendu non virtualisé : lent au-delà de ~300 cartes                                         |
| Liste `[liste]`                               | Vue liste, filtres par statut, échéance et assigné | —                                                                                          |
| Notifications `[notifications]`               | E-mail uniquement, préférence « digest quotidien » | Bug : la préférence digest est mal lue pour les assignations (certaines ne partent jamais) |
| Permissions `[permissions]`                   | Rôles `admin` / `member` codés en dur              | Pas de permission par projet, pas d'invité externe, contrôles dispersés                    |
| Export `[export]`                             | CSV de la vue liste                                | Pas d'export formaté, pas de partage client                                                |
| Champs personnalisés `[champs_personnalises]` | 3 types : texte, nombre, date                      | Pas de liste déroulante ni de formule                                                      |
| Paramètres `[parametres]`                     | Compte, projet, membres                            | —                                                                                          |

## Fonctionnalités existantes

Liste de référence pour repérer une demande qui porte sur quelque chose que Jalon fait **déjà** (`existing_feature`). Dans ce cas, le besoin est un problème de découvrabilité (aide, onboarding), pas une story.

**Tâches**

- Créer, modifier, dupliquer, supprimer une tâche.
- Statuts de tâche : à faire, en cours, en revue, terminé.
- Assigner une tâche à un ou plusieurs membres.
- Fixer une échéance sur une tâche.
- Ajouter une description et des commentaires sur une tâche.
- Joindre des fichiers à une tâche.
- Ajouter des sous-tâches (une checklist dans la tâche).

**Projets**

- Créer, renommer, archiver et désarchiver un projet.
- Inviter des membres de l'espace dans un projet.

**Tableau (kanban)**

- Vue kanban par projet, une colonne par statut.
- Glisser-déposer une carte d'une colonne à l'autre, ou la réordonner dans sa colonne.
- Compteurs de commentaires et de pièces jointes sur chaque carte.
- Replier une colonne ; chaque colonne affiche son nombre de cartes.

**Liste**

- Vue liste de toutes les tâches d'un projet.
- Filtrer la liste par statut, par échéance et **par assigné**.
- Trier la liste par échéance ou par date de création.
- Afficher les champs personnalisés en colonnes.

**Notifications**

- Notifications par e-mail : assignation, commentaire, échéance proche.
- Préférence « digest quotidien » : un seul e-mail récapitulatif par jour.
- Lien de désinscription en un clic dans chaque e-mail ; aucune notification pour ses propres actions.

**Export**

- Export CSV de la vue liste, filtres appliqués, champs personnalisés inclus.
- Copier un lien vers le fichier exporté, valable 7 jours, qui ne s'ouvre que pour un membre connecté de l'espace.

**Champs personnalisés**

- Ajouter des champs de type texte, nombre ou date aux tâches d'un projet, et les réordonner.

**Paramètres et compte**

- Gérer le compte, les membres de l'espace et leurs rôles (`admin` / `member`) : rechercher, désactiver un membre.
- Changer l'adresse e-mail de son compte (avec confirmation).
- Paramètres de projet (nom, description, membres).

## Ce que Jalon ne fait pas

- **Aucune vue Gantt ni timeline**, aucune dépendance entre tâches, aucune date de début (seulement une échéance).
- **Aucun accès pour le client final** : pas d'invité externe, pas de lien de partage hors de l'espace, pas de rapport client.
- Pas de facturation, pas de suivi de temps (non-cibles explicites, voir `strategy.md`).
- Pas de notification in-app, pas d'application mobile.
- Pas d'intégrations natives (Slack, Google Drive, etc.) ni d'API publique documentée.
- Pas de thème sombre ni de raccourcis clavier configurables.
