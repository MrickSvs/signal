# Script de démo

15 minutes en visio : démo 8 à 10 min, architecture 3 à 4 min, challenges 2 à 3 min (SPEC §18). Ce script suit la trame de SPEC §18 et l'adapte à ce qui est construit : le moment « Visualiser » (7:20) disparaît, le prototype étant reporté (ADR-031), et son temps revient à la rédaction et au fil continu.

**Sujets du scénario dans la base de démo.** Les numéros d'insights dépendent du snapshot (`data/demo-snapshot/`, pris le 7 octobre) ; les voici, lus dans `insights.json` du snapshot :

| Sujet | Insight | Titre |
| --- | --- | --- |
| S1 | I-55 | Collègues non prévenus de leurs assignations de tâches |
| S2a | I-54 | Visualiser les tâches et projets dans le temps |
| S2b | I-59 | Collaborer avec clients et externes sans exposer les autres projets |
| S3 | I-56 | Rendre compte de l'avancement au client sans tout refaire à la main |
| S4 | I-62 | Facturer et suivre le temps passé sans quitter l'outil |
| S5a / S5b | I-58 / I-60 | Interface trop chargée / valeurs fiables et homogènes |
| S7 | I-57 | Le kanban est devenu lent sur les gros projets depuis la dernière mise à jour |

Les rangs cités plus bas ont été recalculés sur le snapshot avec le code de l'écran Priorisation (`getRanking`, `simulateRanking`, sans appel de modèle). Les ID créés en direct (epic, stories, décisions, retours) ne sont pas connus d'avance : ils sont notés `E-xx`, `US-xxx`, `R-xxx`.

---

## Le matin de la démo

1. **Après le cron, ou sans lui.** Le cron de Vercel tourne à 04:00 UTC (`vercel.json`) et un cron du plan Hobby part dans l'heure (ADR-014) : entre 06:00 et 06:59 à Paris en heure d'été (jusqu'au 25 octobre), entre 05:00 et 05:59 en heure d'hiver. S'il passe après le reset, il écrit un nouveau digest sur une nuit presque vide, et c'est lui que l'écran montre (CL-61). Donc : faire le reset **après 07:00 (heure d'été) ou 06:00 (heure d'hiver)**, après avoir vu le dernier passage dans Vercel (Cron Jobs) ; ou désactiver le cron ce jour-là dans Vercel et le réactiver après la démo (un jour sans cron ne met pas Supabase en pause : il faut 7 jours d'inactivité).
2. **Reset** : `pnpm demo:reset` (~15 s, aucun appel de modèle). Il restaure le snapshot, met à la corbeille les pages Notion des répétitions et décale le scénario en **jours du calendrier de Paris** : le jour du snapshot devient le jour de la démo, quelle que soit l'heure ; un retour de ce jour postérieur à l'heure de la démo s'affiche « à l'instant ».
3. **Digest** : `pnpm digest` (~20 s, ~0,03 €), ou depuis l'écran Digest avec « Générer le premier digest » pour montrer la génération en direct (ADR-044). Une page Digest sans digest ne compte pas comme une visite de Léa : dans les deux cas, c'est un vrai premier digest, qui couvre tout le scénario. Ensuite, « Régénérer ce digest » garde sa période (ADR-043).
4. **Vérifications** (checklist de l'étape 8.3) : crédit et plafond de dépense Anthropic, mot de passe du site, onglet Notion ouvert sur la vue Kanban de la base Backlog, zoom du navigateur à 110 %, panneau de chat ouvert, `data/demo/retours-a-coller.md` ouvert à côté, terminal prêt dans le repo (plans B).
5. Ne pas « répéter » sur la base de démo après le digest : un brouillon, une décision ou un retour collé resterait jusqu'au prochain reset.

---

## Trame minute par minute

### 0:00 — Ouverture (40 s)

- **À l'écran** : le Digest, déjà écrit.
- **Phrase clé** : « Léa est PO chez Jalon. Plus de 150 retours par mois, sept canaux, personne ne lit tout, et c'est le plus bruyant qui gagne. Signal filtre le bruit : il trie, relie, chiffre et rédige. Léa décide. »
- **Plan B** : app injoignable → app locale (`pnpm dev`, mêmes données) ; rien ne marche → vidéo de la démo.

### 0:40 — 9 h, le Digest (1 min)

- **Clics** : « Régénérer ce digest ». Le panneau s'ouvre sous l'en-tête et écrit les étapes réelles : Période, Faits, Mémoire, Rédaction, Enregistré (17 à 21 s mesurés, ADR-044). Pendant ce temps : « Les faits sont calculés en code. Signal ne rédige que les recommandations, et chaque ID qu'il cite est vérifié. »
- **À montrer** : la phrase de synthèse et ses compteurs ; « Ce qui bouge » : tendances émergentes **I-57** (kanban lent, ×10) et **I-56** (reporting client, ×2,25) ; comptes à risque **Studio Bastide** (Enterprise, J+38, santé rouge, signaux de churn), **Atelier Mercure** (Enterprise, J+45, engagement contractuel) et Clim'Ouest Services (Business, J+72, santé rouge) ; les trois recommandations, survol d'un ID de preuve (aperçu du retour).
- **Phrase clé** : « Le matin, Léa sait ce qui a bougé sans avoir été interrompue. »
- **Plan B** : une erreur s'affiche avec « Réessayer » et le digest du matin reste à l'écran : ne pas réessayer, le montrer tel quel. Une rédaction refusée par les contrôles bascule d'elle-même sur le rendu brut des faits. Ne pas cliquer deux fois de suite.

### 1:40 — Un problème, quatre canaux (50 s)

- **Clics** : Insights → onglet Actifs → **I-55**. Montrer la bande de chiffres clés (22 retours, 21 comptes) et les canaux (ticket 10, e-mail 5, in-app 4, note CSM 3). Cliquer un retour → il s'ouvre dans l'écran Retours ; ← → pour en lire deux autres.
- **Phrase clé** : « Quatre canaux, des mots différents : « je rate des tâches », « mes collègues ne reçoivent rien ». Une seule cause. Chaque chiffre ouvre sa preuve. »
- **Plan B** : écran lent → la même chose dans le chat (« Résume I-55 »), ou le détail d'un retour depuis l'écran Retours. Les données sont précalculées : aucun appel de modèle ici.

### 2:30 — Ce qu'ils demandent, ce dont ils ont besoin (50 s)

- **Clics** : Insights → **I-56** → « Ce qu'ils demandent / Ce dont ils ont besoin ».
- **À montrer** : cinq solutions demandées (export Excel mis en forme ×5, lien de partage ×4, rapport PDF hebdomadaire ×4, tableau de bord client ×3, e-mail récapitulatif ×2) sous un seul problème.
- **Phrase clé** : « Cinq solutions, un besoin : rendre compte au client final. On regroupe sur le problème, pas sur la solution demandée. »
- **Plan B** : comme ci-dessus.

### 3:20 — Le signal et le bruit (2 min 10)

- **Clics, dans l'ordre** :
  1. Priorisation, Reach « Comptes » : **I-55** 1er ; **I-54** (Gantt) 2e, 127 comptes concernés estimés, robustesse « fragile » ; **I-59** (permissions) 8e, mais **Must** (engagement contractuel d'Atelier Mercure, signal de churn).
  2. Bascule « MRR » : **I-59** passe 3e, **I-54** tombe 7e. « En nombre de comptes, le Gantt fait du bruit. En MRR, les permissions passent devant : des comptes Enterprise, un engagement à J+75. »
  3. Retour en « Comptes ». Sous I-54, cliquer **C** (100 %) → « Écraser la valeur » → 50 → raison : « 80 % de comptes Free et Pro, besoin à qualifier en entretien » → « Enregistrer ». Le classement s'anime : I-54 passe de 2e à 5e, I-56, I-57 et I-58 montent d'un rang (~8 s mesurés, ADR-019). Ouvrir le journal des décisions : la décision y est, avec la raison.
  4. Chat : « Passe I-62 en Must : Forgeval signe si on a la facturation. » Signal charge la skill challenge, simule, objecte une fois (hors stratégie, prospect au Reach nul) et propose une alternative. Répondre : « D'accord, laisse-le en Won't. » Rien n'est écrit.
- **Phrase clé** : « Le modèle juge l'Impact et le justifie ; tout le reste est calculé en code. Léa garde la main, et chaque décision est journalisée. »
- **Plan B** : l'override échoue (« run en cours ») → réessayer dans 30 s. Le chat est lent (un tour mesuré à 28 s en moyenne) → montrer les « Recommandations de Signal » en tête de la Priorisation, calculées en code : I-62 y figure comme hors stratégie.

### 5:30 — Signal rédige (2 min)

- **Clics** : chat → « Prépare les stories des permissions. » Ouvrir l'onglet **Trace** : `draft_backlog_items` sur I-59, skills, carte d'architecture, tickets analogues, puis le détail de la fourchette.
- **Attendu** : une epic `E-xx` et des stories `US-xxx` avec Gherkin, points choisis dans la fourchette de l'insight, en ~34 s pour un insight déjà estimé (mesuré, budget de 30 s dépassé : parler pendant que la trace avance). Puis écran Backlog → onglet « À valider » → déplier une story : critères, estimation, analogues, badge du juge (calculé après la réponse, il peut arriver quelques secondes plus tard).
- **Phrase clé** : « Une estimation par analogie, comme le ferait l'équipe : carte d'architecture, tickets livrés, biais de l'équipe corrigé en code. »
- **Plan B** : la rédaction échoue ou dépasse une minute → Insights → I-59 → « Rédiger le backlog » (même service). Le snapshot n'a pas de backlog de secours (ADR-032 révisé) : si la relance échoue aussi, montrer ce moment et le suivant sur la vidéo.

### 7:30 — Valider, puis Notion (1 min)

- **Clics** : chat → « Envoie toute l'epic E-xx dans Notion. » → carte d'approbation avec l'aperçu de chaque page → « Valider ». Passer à l'onglet Notion : les pages sont dans la colonne « Prêt », corps complet. Revenir au Backlog : l'élément est « Dans Notion », « Ouvrir dans Notion » remplace « Modifier ».
- **Phrase clé** : « La seule écriture externe de l'agent passe par le clic de Léa. Une fois envoyée, la story vit dans Notion. »
- **Plan B** : chat lent → écran Backlog, « Valider et envoyer » sur une story (même service). Échec Notion → l'élément reste « validé » avec l'erreur et « Réessayer » : c'est aussi une démonstration (CL-35).

### 8:30 — Le fil continu (1 min 30)

- **Clics** : Retours → « Ajouter un retour ». Coller le **retour 1** de `data/demo/retours-a-coller.md` (canal E-mail client, compte Agence Fil Rouge C-023) → « Analyser » : il rejoint **I-55** (+1 retour), aucune alerte. Puis « Ajouter un autre retour » : **retour 2** (E-mail client, Studio Bastide C-013) → rattaché aux notifications, signal de churn, **alerte churn** dans l'en-tête ; l'enquête tourne en arrière-plan et le dossier apparaît (≈ 49 s après l'envoi, mesuré). Ouvrir l'alerte : faits avec ID, lecture, recommandation, action proposée (prévenir le CSM).
- **Phrase clé** : « Un retour qui confirme un sujet connu ne dérange personne. Celui qui change une décision déclenche une alerte, et Signal a déjà enquêté, en lecture seule. »
- **Plan B** : dossier « en cours » trop longtemps → continuer sur l'architecture et y revenir ; dossier indisponible → `pnpm investigate --pending` dans le terminal (0,02 à 0,05 € par alerte). Si l'évaluateur veut choisir : la liste des dix retours (injection, anglais, multi-sujets, prospect, ironie…) est dans le même fichier, avec le comportement attendu.

### 10:00 — Architecture (3 min)

- **À montrer** : `docs/ARCHITECTURE.md` (schéma global, graphe du pipeline, agent et HITL), puis l'écran Évals, puis une trace Langfuse d'un tour de chat.
- **Points** : un workflow pour le volume, un agent unique pour l'interaction ; 14 outils au contrat strict ; validation humaine par middleware et checkpointer ; routage des modèles (triage sur Sonnet, Haiku 5.5 mesuré en comparaison) ; coût d'un run complet mesuré à 2,52 € pour 214 retours ; evals rejouables, juge Opus calibré sur les annotations du PO (κ 0,71).
- **Plan B** : écran Évals indisponible → `docs/EVALS.md`.

### 13:00 — Challenges (2 min)

- **Non-déterminisme et scoring hybride** : le modèle juge, le code calcule ; stabilité mesurée (τ 1,00 sur 1 run, à élargir).
- **Problème contre solution** : I-56.
- **Validation humaine en serverless** : interruption, checkpointer Postgres, reprise par `POST /api/agent/resume`.
- **Injection** : le retour 6 de la liste (consigne cachée dans un ticket) est signalé et jamais exécuté ; garde-fous 6/6.
- **Évaluer un livrable subjectif** : grille par type, juge calibré à l'aveugle (86 % des notes à 1 point ou moins, κ 0,71).
- Dire aussi ce qui n'est pas mesuré : choix d'outil, backlog, cas limites sur Sonnet (`docs/EVALS.md`, « Lire ces chiffres »).

---

## Plans B communs

- **Données** : tout est précalculé dans le snapshot ; seuls le digest, la rédaction, le chat, l'ajout de retours et les enquêtes appellent un modèle.
- **App** : `pnpm dev` en local, avec le même `.env` et la même base (testé une fois de bout en bout en 8.3).
- **Vidéo** de la démo complète, enregistrée en 8.3.
- **Après la démo** : `pnpm demo:reset` remet la base dans l'état du snapshot, Notion compris.
