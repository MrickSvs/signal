---
name: user-story
description: À utiliser pour rédiger ou réécrire une user story (valeur, persona, besoin, règles de gestion, Gherkin, KPI) et pour découper une epic en stories verticales conformes à INVEST.
---

# User story

## Objectif

Écrire des stories qu'un développeur, un designer et la QA comprennent sans réunion : la valeur d'abord, le besoin ensuite, des règles claires et des critères testables. Le format suit la définition de la user story du _Dico du Produit_ de Thiga, dans sa forme qui commence par la valeur (elle évite de répéter le « quoi » dans le « pourquoi »). Le choix du type d'élément relève de la skill `backlog-format`.

## Gabarit complet

```
US-XXX — <Titre : un verbe à l'infinitif + l'objet, 8 mots au plus>
Afin de <valeur ou résultat pour l'utilisateur>,
en tant que <persona, désigné par son rôle>,
je veux <capacité, sans détail d'implémentation>.

Règles de gestion
- <règle métier vérifiable>
- …

Critères d'acceptation
Scénario : <cas nominal>
  Étant donné <contexte>
  Quand <action>
  Alors <résultat observable>
  Et <résultat complémentaire>
Scénario : <cas limite ou d'erreur>
  …

KPI de succès : <indicateur mesurable, cible et horizon, relié à un OKR si possible>
Estimation : <points> points — composants : <identifiants d'architecture.md> · analogue <T-xxx> (<estimés> pts estimés, <réels> réels)
Dépendances : <ID ou « aucune »>
Preuves : <R-xxx, R-yyy>
Maquette : <lien du prototype, si généré>
```

## Règles

1. **La valeur d'abord.** « Afin de » décrit un résultat pour l'utilisateur (gagner du temps, éviter une erreur, rassurer un client), jamais la fonctionnalité elle-même.
2. **Le persona par son rôle** (`personas.md`) : « chef de projet en agence », « directeur d'agence », « client final invité », « membre d'équipe ». Jamais « utilisateur » tout court, jamais un prénom.
3. **« Je veux » exprime une capacité**, pas une solution technique (« voir l'avancement de mon projet », pas « une API REST de statut »).
4. **Règles de gestion** : 2 à 6 règles métier, vérifiables, sans ambiguïté (« un invité ne voit que… », « l'invitation expire après 7 jours »). Elles alimentent les scénarios.
5. **Gherkin en français** : mots-clés `Scénario`, `Étant donné`, `Quand`, `Alors`, `Et`, `Mais`. **2 à 5 scénarios**, dont au moins un cas limite ou d'erreur. Données concrètes et réalistes (noms de projet, e-mails fictifs), une seule action par `Quand`, un résultat observable par `Alors`.
6. **KPI de succès** : un indicateur mesurable avec une cible et un horizon, relié à l'OKR de l'epic quand c'est possible.
7. **Estimation** : une valeur Fibonacci (1, 2, 3, 5, 8, 13), les composants touchés et un ticket analogue (skill `estimation`). Au-delà de 8, découpe.
8. **Preuves** : 1 à 5 retours de l'insight qui motivent la story.
9. **Pas de chiffre inventé** : les chiffres du KPI reprennent les OKRs ou les faits fournis.

## Checklist INVEST

- [ ] **Indépendante** : livrable sans attendre une autre story (sinon, dépendance listée).
- [ ] **Négociable** : décrit le besoin, laisse la solution ouverte.
- [ ] **Valeur** : un utilisateur voit la différence une fois livrée.
- [ ] **Estimable** : l'équipe comprend assez pour estimer.
- [ ] **Small** : 8 points au plus, tient dans un sprint.
- [ ] **Testable** : chaque règle de gestion est couverte par un scénario.

## Découpage vertical

Une epic se découpe en **tranches de valeur**, chacune utilisable de bout en bout, pas en couches techniques.

- Par **parcours** : inviter → consulter → révoquer.
- Par **règle** : d'abord la lecture seule, puis le commentaire.
- Par **périmètre** : un projet, puis plusieurs.
- Par **cas** : nominal d'abord, cas rares ensuite.

Une tâche technique de prérequis peut précéder les stories ; elle ne remplace pas une tranche de valeur.

## Bon exemple

```
US-021 — Partager un lien de suivi avec mon client
Afin de rassurer mon client sans lui préparer de rapport chaque semaine,
en tant que chef de projet en agence,
je veux lui partager un lien en lecture qui montre l'avancement du projet.

Règles de gestion
- Le lien montre les tâches, leur statut et leur échéance, sans les commentaires internes.
- Le lien peut être désactivé à tout moment par un admin du projet.
- Un lien désactivé affiche « Ce lien n'est plus actif ».

Critères d'acceptation
Scénario : consultation du lien par le client
  Étant donné que j'ai généré un lien de suivi pour le projet « Campagne printemps »
  Quand mon client ouvre le lien
  Alors il voit les tâches du projet avec leur statut et leur échéance
  Et il ne voit aucun commentaire interne
Scénario : lien désactivé
  Étant donné que j'ai désactivé le lien du projet « Campagne printemps »
  Quand mon client ouvre l'ancien lien
  Alors il voit le message « Ce lien n'est plus actif »

KPI de succès : 25 % des projets actifs avec un accès client à 90 jours (O2-KR1)
Estimation : 5 points — composants : export, permissions · analogue T-124 (3 pts estimés, 5 réels)
Dépendances : aucune
Preuves : R-031, R-077, R-140
```

## Mauvais exemple commenté

```
US-022 — Export
En tant qu'utilisateur, je veux un export PDF afin d'avoir un export PDF.
Critères : l'export marche bien et est rapide.
```

- Ne commence pas par la valeur, et le « afin de » répète le « je veux ».
- « Utilisateur » n'est pas un persona ; le titre n'est pas une action.
- La solution (PDF) remplace le besoin (rendre compte au client).
- Les critères ne sont ni en Gherkin ni testables (« marche bien », « rapide »).
- Ni règle de gestion, ni KPI, ni estimation, ni preuve.

## Erreurs fréquentes

- Un scénario qui teste trois choses à la fois : une action par `Quand`.
- Oublier le cas d'erreur (accès refusé, lien expiré, champ vide).
- Écrire les règles de gestion dans les scénarios au lieu de les lister.
- Un KPI d'activité (« nombre de clics ») au lieu d'un KPI de résultat.
- Une story « technique » déguisée (« en tant que développeur ») : c'est une tâche technique.
