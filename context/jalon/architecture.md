# Carte d'architecture de Jalon

> Doc interne de l'équipe technique. Vue d'ensemble pour estimer, pas documentation de code. Sert à l'estimation par analogie : on identifie les modules touchés, leur couplage et les zones à risque, puis on compare aux tickets déjà livrés.

## Vue d'ensemble

- Un **monolithe web** (API + rendu serveur) et un **front** monopage, une base **Postgres** unique, une **file de tâches** pour les envois d'e-mails.
- Le modèle de données tourne autour de quatre objets : **espace** (le compte client), **membre**, **projet**, **tâche**.
- Pas de notion d'utilisateur externe à l'espace : toute personne qui se connecte est un membre.

## Modules

Les identifiants ci-dessous sont les noms de composants utilisés dans les tickets de référence (`components`). Ils ne changent pas.

| Identifiant            | Module               | Couplage |
| ---------------------- | -------------------- | -------- |
| `taches`               | Tâches               | fort     |
| `tableau`              | Tableau (kanban)     | faible   |
| `liste`                | Liste                | moyen    |
| `notifications`        | Notifications        | moyen    |
| `permissions`          | Permissions          | fort     |
| `export`               | Export               | moyen    |
| `champs_personnalises` | Champs personnalisés | moyen    |
| `parametres`           | Paramètres           | faible   |

### `taches` — Tâches (couplage fort)

- **Responsabilités** : modèle projet / tâche, statuts, assignation (plusieurs assignés), échéance, commentaires, pièces jointes, sous-tâches en checklist. Émet les événements métier (tâche assignée, commentée, échéance proche).
- **Pourquoi fort** : tout le reste lit ce modèle. Ajouter un attribut structurant (date de début, dépendance entre tâches) touche le tableau, la liste, l'export, les notifications et les champs personnalisés.
- **Zones à risque** : aucune date de début (seulement une échéance) ; aucune dépendance entre tâches. Toute vue planning (Gantt, timeline) commence par une migration du modèle.

### `tableau` — Tableau kanban (couplage faible)

- **Responsabilités** : vue kanban d'un projet, une colonne par statut, glisser-déposer qui change le statut.
- **Pourquoi faible** : lit les tâches et appelle l'API de changement de statut, rien d'autre.
- **Zones à risque** : **rendu non virtualisé** : toutes les cartes sont chargées en une requête et rendues d'un bloc ; lent au-delà de ~300 cartes. Le glisser-déposer recalcule tout le tableau. La virtualisation est un chantier front isolé mais délicat (glisser-déposer entre colonnes virtualisées).

### `liste` — Liste (couplage moyen)

- **Responsabilités** : vue liste, filtres (statut, échéance, assigné), tri, pagination. Fournit la requête filtrée reprise par l'export.
- **Pourquoi moyen** : l'export et les champs personnalisés s'appuient sur ses requêtes ; un changement de filtre se répercute sur l'export.
- **Zones à risque** : filtres sur champs personnalisés absents ; requêtes construites à la main.

### `notifications` — Notifications (couplage moyen)

- **Responsabilités** : écoute les événements de `taches`, choisit le canal (e-mail uniquement), applique les préférences de l'utilisateur (immédiat ou **digest quotidien**), envoie via la file de tâches.
- **Pourquoi moyen** : dépend des événements de `taches` et des préférences stockées dans `parametres`.
- **Zones à risque** : **préférence digest mal lue** : le chemin des assignations lit encore l'ancien champ de préférence ; quand le digest est activé, certaines assignations ne sont ni envoyées immédiatement ni incluses dans le digest. Pas de journal d'envoi exploitable par le support. Pas de canal in-app.

### `permissions` — Permissions (couplage fort)

- **Responsabilités** : rôles `admin` / `member` **codés en dur** au niveau de l'espace ; un membre voit tous les projets de l'espace.
- **Pourquoi fort** : il n'y a pas de couche d'autorisation centrale. Les contrôles sont **dispersés dans 5 écrans** (page projet, détail de tâche, tableau, liste, paramètres) **et dans l'export**, chacun avec sa propre condition.
- **Zones à risque** : **aucune notion d'invité** ni d'utilisateur externe ; aucune permission par projet. Ajouter un rôle ou un périmètre impose de reprendre les 6 points de contrôle, de migrer les membres existants et de tout retester. Historiquement sous-estimé.

### `export` — Export (couplage moyen)

- **Responsabilités** : export CSV de la vue liste, filtres appliqués, génération synchrone ; lien de téléchargement du fichier réservé aux membres connectés (7 jours).
- **Pourquoi moyen** : dépend de la requête de `liste`, des champs personnalisés et de son propre contrôle de permissions.
- **Zones à risque** : pas de moteur de mise en forme (ni Excel formaté, ni PDF) ; pas de lien de partage hors de l'espace ni d'accès sans compte ; génération synchrone, lue par lots, qui peut encore expirer sur les très gros projets. Historiquement sous-estimé.

### `champs_personnalises` — Champs personnalisés (couplage moyen)

- **Responsabilités** : définition de champs par projet, **3 types** (texte, nombre, date), saisie dans le détail de tâche, affichage en liste et dans l'export.
- **Pourquoi moyen** : chaque nouveau type doit être pris en charge par le formulaire de tâche, la liste, l'export et, à terme, les filtres.
- **Zones à risque** : stockage générique (une table clé-valeur typée) ; une liste déroulante demande une table d'options, une formule un moteur de calcul.

### `parametres` — Paramètres (couplage faible)

- **Responsabilités** : compte et espace, projets (nom, description, membres), gestion des membres et de leur rôle, préférences utilisateur (dont les préférences de notification).
- **Pourquoi faible** : écrans de configuration, peu de logique.
- **Zones à risque** : stocke deux champs de préférence de notification (l'ancien et le nouveau), source du bug digest.

## Dépendances entre modules

| Module                 | Dépend de                                       |
| ---------------------- | ----------------------------------------------- |
| `tableau`              | `taches`, `permissions`                         |
| `liste`                | `taches`, `permissions`, `champs_personnalises` |
| `notifications`        | `taches`, `parametres`                          |
| `export`               | `liste`, `champs_personnalises`, `permissions`  |
| `champs_personnalises` | `taches`                                        |
| `parametres`           | `permissions`                                   |
| `taches`               | `permissions`                                   |
| `permissions`          | — (mais appelé par presque tout)                |

## Dette connue, par ordre de risque

1. **Permissions dispersées** dans 5 écrans et dans l'export, sans couche centrale. Prérequis de tout travail sur les invités ou les permissions par projet.
2. **Aucune notion d'invité, de dépendance entre tâches ni de date de début** dans le modèle de données.
3. **Préférence digest mal lue** pour les assignations (deux champs de préférence coexistent).
4. **Kanban non virtualisé** : lent au-delà de ~300 cartes.
5. **Champs personnalisés limités à 3 types**, stockage générique.

## Lire cette carte pour estimer

- Compter les modules touchés ; un module à couplage **fort** pèse plus qu'il n'en a l'air.
- Une zone à risque traversée ajoute de l'incertitude : élargir la fourchette, la citer dans les risques.
- Un nouveau concept dans le modèle de données (invité, dépendance, date de début) est un chantier, pas une story.
