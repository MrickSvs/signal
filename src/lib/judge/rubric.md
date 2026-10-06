# Grille du juge qualité du backlog

Grille commune au juge (rôle `judge`) et à l'annotation humaine de calibration (SPEC §14.3). Chaque élément est noté avec la grille de son type, critère par critère, de 1 à 5, puis reçoit un verdict.

Échelle commune : **5** irréprochable, prêt pour le sprint ; **4** bon, une retouche mineure ; **3** utilisable mais une faiblesse réelle à corriger ; **2** défaut qui bloque le développement ou la recette ; **1** absent ou faux.

**Verdict.** `acceptable` : l'équipe peut prendre l'élément en sprint après au plus des retouches mineures (en pratique, aucune note sous 3 et la plupart à 4 ou plus). `a_reprendre` : un défaut doit être corrigé avant le sprint (une note à 1 ou 2 suffit en général).

Noter ce qui est écrit, pas ce que l'élément aurait pu être. Un champ vide ou générique (« améliorer l'expérience ») est noté comme absent.

## story

### invest

INVEST détaillé : **I**ndépendante (livrable seule, sinon dépendance listée), **N**égociable (le besoin, pas la solution technique), **V**aleur (« afin de » décrit un résultat pour l'utilisateur et ne répète pas le « je veux »), **E**stimable (assez clair pour estimer), **S**mall (8 points au plus, une seule tranche de valeur), **T**estable (couvert par les scénarios, noté au critère suivant).

- **5** : les cinq qualités sont là ; la valeur est un résultat concret (« rassurer mon client sans lui préparer de rapport »).
- **4** : une qualité un peu faible (valeur juste mais générique, ou dépendance implicite).
- **3** : une qualité clairement manquante, par exemple une solution imposée (« un bouton qui appelle l'API d'export »).
- **2** : valeur absente ou qui répète le « quoi » (« afin de pouvoir exporter » pour « je veux exporter »), ou story trop grosse (plusieurs parcours, plus de 8 points).
- **1** : pas une story : une liste de tâches techniques ou plusieurs besoins sans lien.

### testabilite

Les critères d'acceptation : 2 à 5 scénarios Gherkin, un résultat observable par `Alors`, des données concrètes, au moins un cas limite ou d'erreur, chaque règle de gestion couverte.

- **5** : chaque règle est couverte, un cas limite pertinent, des résultats vérifiables par la QA sans interprétation.
- **4** : scénarios testables, un cas limite faible ou une règle mineure non couverte.
- **3** : nominal testable mais pas de vrai cas limite, ou un `Alors` vague.
- **2** : résultats non observables (« l'expérience est fluide », « l'utilisateur est satisfait »).
- **1** : pas de scénario, ou des scénarios qui ne testent pas la story.

### tracabilite

Le lien entre l'élément et ce qui le justifie : retours en preuve (R-xxx) cohérents avec le besoin, KPI de succès mesurable (cible et horizon), relié à un OKR quand c'est possible.

- **5** : preuves pertinentes, KPI mesurable avec cible et horizon, OKR cité.
- **4** : preuves pertinentes et KPI mesurable, sans cible ou sans horizon.
- **3** : preuves présentes mais KPI vague (« plus de satisfaction »).
- **2** : preuves sans rapport avec la story, ou KPI absent.
- **1** : aucune preuve.

### format

Le gabarit de la skill `user-story` : titre court à l'infinitif ; « Afin de / en tant que / je veux » ; persona désigné par son rôle (jamais « utilisateur », jamais un prénom) ; 2 à 6 règles de gestion vérifiables ; Gherkin en français.

- **5** : gabarit complet et propre.
- **4** : un écart mineur (titre long, une règle de gestion floue).
- **3** : un élément du gabarit faible (persona « utilisateur », règles non vérifiables).
- **2** : plusieurs éléments manquants ou mal remplis.
- **1** : gabarit non suivi.

## bug

### reproductibilite

Des étapes de reproduction rejouables par un développeur : conditions de départ, actions numérotées, données concrètes.

- **5** : on reproduit sans poser de question (contexte, compte, préférence, étapes).
- **4** : rejouable, un détail de contexte manque.
- **3** : étapes approximatives, il faut deviner une condition.
- **2** : une phrase qui raconte le symptôme sans étapes.
- **1** : pas d'étapes.

### attendu_constate

Le comportement attendu et le comportement constaté, distincts, précis et comparables.

- **5** : les deux sont précis et l'écart saute aux yeux.
- **4** : précis, l'un un peu générique.
- **3** : l'un des deux vague (« ça ne marche pas bien »).
- **2** : attendu et constaté confondus ou reformulés l'un dans l'autre.
- **1** : l'un des deux absent.

### severite

La sévérité (`bloquant`, `majeur`, `mineur`) cohérente avec l'usage touché et les preuves (comptes touchés, deadline ratée, contournement possible), et justifiée.

- **5** : sévérité juste et justifiée par les faits.
- **4** : juste, justification implicite.
- **3** : discutable d'un cran.
- **2** : fausse d'un cran sur un usage cœur, ou gonflée sans fait.
- **1** : absente ou absurde.

### critere_correction

Les scénarios Gherkin du correctif : testables, dont un cas limite (régression, préférence particulière, volume).

- **5** : le correctif est vérifiable, cas limite pertinent, non-régression couverte.
- **4** : testable, cas limite faible.
- **3** : seul le cas nominal.
- **2** : critère non vérifiable (« le bug est corrigé »).
- **1** : aucun critère.

## tache

### objectif

L'objectif technique : ce qui change, pourquoi (le risque ou le besoin servi), mesurable ou vérifiable.

- **5** : objectif précis, rattaché au besoin et vérifiable.
- **4** : précis, rattachement implicite.
- **3** : objectif compréhensible mais flou sur le résultat attendu.
- **2** : une intention (« améliorer la sécurité ») sans résultat.
- **1** : absent.

### definition_termine

La définition de terminé : des conditions vérifiables, qu'un relecteur coche sans interprétation, avec les risques réels identifiés.

- **5** : chaque condition est vérifiable, risques réels listés.
- **4** : vérifiable, un risque manque.
- **3** : une condition vague (« le code est propre »).
- **2** : conditions non vérifiables.
- **1** : absente.
