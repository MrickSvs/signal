# Changelog — Signal

Suivi de l'avancement pour un relecteur technique. Une entrée par étape de [PLAN.md](PLAN.md), la plus récente en haut.
Pour le détail : le **pourquoi** des choix est dans [docs/DECISIONS.md](docs/DECISIONS.md) (ADR), les durées et coûts dans [docs/BUILD_LOG.md](docs/BUILD_LOG.md), le **quoi** dans [SPEC.md](SPEC.md), les règles de travail dans [CLAUDE.md](CLAUDE.md).

## État actuel

- **Phase 3 (cockpit) commencée** : 3.1 (shell, composants de preuve, formatage en heure de Paris), 3.2 (écran Digest) et 3.3 (écran Retours) faites. Prochaine étape : 3.4 (écran Insights).
- **Phase 2 (pipeline) terminée** : 2.1 à 2.7 faites. Le pipeline tourne de bout en bout en graphe LangGraph (`pnpm pipeline:run`, reprise avec `--resume`) jusqu'au digest ; mode incrémental (`POST /api/pipeline/incremental`), alertes, digest à la demande (`pnpm digest`) et cron quotidien (`GET /api/cron/digest`). Checklists 2.6 et 2.7 validées, sauf la latence de l'incrémental (voir ci-dessous).
- Base Supabase : 90 clients + 5 prospects, 40 tickets de référence, 214 retours de développement + 10 retours d'essai (R-215 à R-224). 25 insights au statut « propose » (I-26 à I-50), 11 classés et scorés ; S1 à S7 présents (S4 en signal faible). 3 alertes d'essai ouvertes (dossiers vides jusqu'à 4.5). 5 digests (le premier sans historique). Le jeu réservé (77 retours) reste hors base.
- App déployée sur Vercel (production, protégée par Basic Auth) : https://signal-coral-two.vercel.app — shell du cockpit, sections encore vides ; routes `/api/pipeline/*` et `/api/cron/digest`, région `dub1`, cron quotidien à 4 h UTC.
- CI GitHub Actions (lint, typecheck, tests, sans aucune clé) : 401 tests. `lib/scoring` couvert à 100 % (`pnpm test:coverage`).
- Coût LLM cumulé : ~5,5 € (génération des tickets ~0,21 €, des retours ~2,1 €, triage ~0,34 €, regroupement ~0,31 €, estimation ~0,13 €, scoring ~0,81 €, run complet sur base vide ~1,3 €, essais incrémentaux ~0,18 €, digests ~0,09 €).

## Points d'attention

- **Écart avec PLAN 0.3 — températures** : Sonnet 5.5 et Opus 5.5 rejettent toute `temperature` non par défaut. Seul le triage (Haiku) a `temperature: 0` ; les autres rôles tournent en réflexion adaptive. Conséquence pour 6.3 : la stabilité du juge repose sur la calibration, pas sur la température. → ADR-003
- **Sorties structurées** : natives (`output_config.format`), pas d'appel d'outil forcé (refusé par Sonnet/Opus 5.5). Tout passe par `invokeStructured()`. → ADR-003
- **Cache de prompt sur Haiku** : vérifié en 2.1, le préfixe du triage (~5 900 tokens) dépasse le minimum de 4 096 ; le run complet lit le cache à chaque appel. → ADR-008
- **Enums des sorties structurées** : jusqu'à 2.1, `transformJSONSchema` du SDK les retirait du schéma (ils n'étaient pas imposés). Corrigé dans `invokeStructured()` ; la nouvelle tentative après une sortie invalide reçoit maintenant les erreurs. → ADR-008
- **Seed et rattachement** : le seed ne charge le compte que pour les commentaires in-app et les NPS ; `pnpm pipeline:run` refait le rattachement (nœud `enrich`) après tout `db:seed`. Les signaux business ne sont pas stockés, ils sont recalculés à la demande. → ADR-009
- **Seuil de regroupement** : 0,28 et non 0,35 (valeur initiale), mesuré sur voyage-4 : tout fusionne dès 0,35. Seuil d'appariement par centroïdes : 0,9. → ADR-010
- **Insights fusionnés** : ils gardent leurs `insight_items`, figés, comme mémoire pour rejouer la fusion au run suivant. Toute lecture des items d'un insight filtre sur son statut. → ADR-010
- **Bruit classé** : trois petits sujets du bruit se regroupent légitimement au-delà de 5 retours (« recréer les mêmes tâches » 7, filtre par assigné E5 + S6 5, usage mobile 5) et sont classés. **Décision du PO : accepté**, ce sont de vrais problèmes récurrents ; la règle des 5 retours reste inchangée. S3 sort aussi émergent (×2,25) à côté de S7 (×14). → ADR-010
- **Voyage sans moyen de paiement** : 3 requêtes/min et 10 000 tokens/min ; le premier embedding des 234 items a dû passer par petits lots espacés. Le scoring contourne la limite en vectorisant les besoins de tous les insights en un seul appel. Ajouter un moyen de paiement avant 2.6 (run complet sur base vide).
- **Sentiment du triage** : le signe ne correspond à la vérité terrain que pour 162 retours sur 214 ; les retours neutres sortent souvent à −1 ou +1. À mesurer et corriger avec `eval:triage` (6.2), pas avant.
- **Volumes du jeu de données revus** (décision du PO) : bruit ~100 au lieu de ~140, soit 214 retours au lieu de ~265 ; SPEC §1 dit « plus de 150 retours par mois ». Volumes des patterns inchangés. → ADR-006
- **Seuil d'analogue proche** : 0,45 et non 0,6, d'après les similarités mesurées sur voyage-4 ; confirmé en 2.4 (permissions 0,49–0,59, notifications 0,50–0,56, suivi du temps ≤ 0,37). → ADR-005, ADR-011
- **Migration 0003** : `overrides.feedback_ids` (retours au moment de l'override, pour le « contexte modifié ») et `scores.overridden` (valeur d'origine d'un paramètre écrasé). L'écran Priorisation (3.5) et l'agent doivent renseigner `feedback_ids` à la création d'un override. → ADR-012
- **MoSCoW** : les cinq règles de la skill (quartiles compris) sont dures ; le code corrige toute recommandation du modèle qui en diffère et le signale dans `rule_flags`. → ADR-012
- **Jugements non déterministes** : d'un run à l'autre, le modèle peut changer un Impact (I-01 : 1 puis 2) ou signaler une contradiction. Changer de mode Reach par la CLI rejuge tout ; l'écran Priorisation devra recalculer en code. À mesurer avec `eval:stability` (6.2). → ADR-012
- **Biais de l'équipe dilué** : le facteur est la moyenne sur tous les tickets qui touchent les composants retenus ; quand le modèle liste beaucoup de modules par ricochet, celui des permissions (× 1,65) tombe à × 1,31. À mesurer avec `eval:estimation` (6.2). → ADR-011
- **Vérité terrain enrichie** par rapport à PLAN 1.4 : `topic` (sujet de bruit), `acceptable_areas` (domaine ambigu) et `churn_signal`. Le runner `eval:triage` (6.2) doit en tenir compte. Les retours réservés ont des ID `H-001`…, pas `R-`. → ADR-007
- **Régénérer les retours** : le cache `.cache/feedback-texts/` évite de repayer, mais modifier un angle de `scenario.yaml` invalide tout le jeu réservé (~0,7 €). Le test des fichiers versionnés échoue tant qu'ils ne suivent plus le plan. → ADR-007
- **Heure du seed** : un retour « du jour » est placé avant l'instant du seed ; seedé la nuit, il tombe hors des heures de bureau. Seeder en journée avant une démo.
- **`LANGFUSE_BASE_URL` sur Vercel corrigée en 2.7** : elle contenait des guillemets littéraux depuis 0.3, et le hook d'instrumentation faisait échouer toute requête serveur (500). Invisible jusqu'ici, faute de route serveur. Premier déclenchement réel du cron en production réussi (200, digest rédigé par Signal en 15,7 s, 0,03 €) : toutes les variables qu'il lit sont valides.
- **Variables Vercel** : définies en **Production** seulement (pas Preview/Development). `DATABASE_URL` (2.6) et `CRON_SECRET` (2.7, généré, aussi dans `.env`) ajoutées.
- **`DATABASE_URL` = pooler Supabase en mode session** (port 5432) : la connexion directe n'existe qu'en IPv6 (injoignable en local comme depuis Vercel) et le mode transaction (6543) ne garde pas le verrou de session du pipeline. Les migrations, elles, passent par la CLI Supabase, pas par cette variable. → ADR-013
- **Latence de l'incrémental** : 15 à 25 s par retour en local (triage Haiku 5–7 s, Voyage ~2 s, ~0,2 s par requête Supabase depuis le poste), au-dessus du budget de 15 s (SPEC §15). **Région Vercel passée en `dub1` (près de Supabase eu-west-1) en 2.7 ; reste à remesurer en ligne** (le PO, l'app déployée étant protégée par mot de passe). Un insight qui devient classé déclenche sa première estimation et son premier jugement (~48 s). → ADR-013
- **Incrémental sans rejugement** : un retour ajouté reprend le jugement stocké du modèle (`scores.judgment`, migration 0004) et recalcule les faits en code (Reach, Confidence, règles MoSCoW, rang). Le run de nuit rejuge tout, ~0,8 € même sans changement (dette : étendre la réutilisation au run complet). → ADR-013
- **Pas d'alerte au premier run** sur une base sans insight : tout y est nouveau, le digest en rend compte. L'alerte `churn` porte sur le compte, pas sur l'insight. → ADR-013
- **S4 en signal faible** après le run sur base vide : le triage Haiku a classé deux retours de Forgeval (R-122, R-213) en « autre » ; I-39 n'a plus que 4 retours, il n'est donc ni scoré ni Won't. Variance du triage, à mesurer avec `eval:triage` (6.2), pas corrigée à la main.
- **Test instable corrigé** (`8001d0f`) : `loadContextPack` lisait les fichiers en parallèle et l'erreur nommait le premier fichier manquant à échouer ; elle nomme désormais le premier dans l'ordre du pack.
- **Digest** : faits calculés en code, rédaction refusée si elle cite un ID inconnu, une ligne chiffrée sans ID ou une date absolue (une nouvelle tentative, puis repli sur un rendu brut). Compte à risque = renouvellement < 90 jours + churn ou santé rouge (le sentiment négatif seul ne suffit pas). Un retour est « nouveau » selon sa date d'entrée en base. Le cron ne retente pas les triages en échec : le run complet le fait. Cron à 4 h UTC : 6 h à Paris l'été, 5 h l'hiver. → ADR-014
- **Langfuse** : compte récent, la lecture des traces passe par l'API `v2/observations` (l'API `traces` historique est fermée).

## [3.3] Écran Retours — 2026-10-03

`7a92881` · ADR-017

- `/retours` : tableau paginé côté serveur (25 par page) sur la vue `feedback_inbox` (migration 0005) : ID, date relative, canal, compte et plan, résumé, types et domaines, insights, signaux (échec d'analyse, injection, churn, fonctionnalité existante, langue, tronqué ; 3 au plus par ligne).
- Filtres dans l'URL (canal, plan ou « compte non identifié », segment, type, domaine, insight, période, injection, fonctionnalité existante, échec d'analyse) et recherche plein texte simple (ID, objet, verbatim, résumés).
- Panneau de détail (`?retour=R-042`) : verbatim en texte, compte, analyse, chaque item avec ses insights et « pourquoi ce classement » (composé en code depuis les champs stockés), lien Notion s'il existe.
- « Ajouter un retour » : modale → pipeline incrémental → rattachement, nouveau sujet à valider ou sujet à surveiller, durée et coût ; message clair si un run est en cours.
- Vérifié sur la base réelle (requêtes et pipeline) : filtre injection → R-144 (S6) ; R-011 (E1) → 2 items, I-27 et I-26 ; un texte proche de S1 → R-224 rattaché à I-27 (similarité 0,86, 18 s, 0,007 €).
- Checklist 3.3 validée (rendu, panneau, filtres et modale vérifiés dans le navigateur par le PO). Poussée sur `main`.

## [3.2] Écran Digest — 2026-10-03

`7e84c22` · ADR-016

- Page d'accueil : le dernier digest dans l'ordre de SPEC §12.2, structuré depuis les faits calculés en code ; ID cliquables, chiffres vers leurs preuves, sparklines 6 semaines, comptes à risque avec MRR, décisions en attente avec un lien vers l'écran qui les traite (fusions et scissions comprises, CL-15).
- Recommandations en cartes : le schéma passe d'`action` à `titre` + `justification` (les anciens digests restent lisibles) ; « En parler à Signal » désactivé jusqu'à 4.2.
- Premier run (CL-18) : pas de section « Mouvements », « Pas encore d'historique ».
- « Régénérer » avec confirmation (server action sous le verrou du pipeline, ~25 s, ~0,03 €) ; lien vers le digest précédent ; `po_state.last_seen_at` mis à jour à chaque visite.
- Checklist 3.2 validée (écran sans historique vérifié ; lecture en 30 secondes validée par le PO). Poussée sur `main`.

## [3.1] Shell et composants transverses — 2026-10-03

`da46dbf` · ADR-015

- Layout : sidebar (Digest, Retours, Insights, Priorisation, Backlog, Évals, Contexte), en-tête avec statut du dernier run et badge des alertes ouvertes (liste avec insight, preuves et état du dossier), panneau de chat repliable (vide jusqu'à 4.2). États vide, de chargement, d'erreur et 404 communs.
- `src/lib/format.ts` : nombres, euros, coûts, pourcentages, dates et dates relatives en français, toujours en heure de Paris (CL-44) ; `src/lib/labels.ts` : libellés des enums.
- Composants de preuve : `EvidenceChip` (verbatim, canal, compte, plan, santé, date, liens), `InsightChip`, `BacklogItemChip`, `MetricWithSource`, badges canal / plan / santé / modèle / type. Aperçus chargés à l'ouverture par des server functions en lecture seule.
- Inter et accent vert ; texte courant ≥ 14 px, vérifié à 1 280 × 800 et à 110 % de zoom (CL-47).
- Checklist 3.1 validée (navigation, verbatim réel de R-215, heure de Paris depuis America/Buenos_Aires). Poussée sur `main` pour un test en production par le PO.

## [2.7] Digest — 2026-10-03

`0a837b3` · ADR-014

- `src/pipeline/nodes/digest.ts` : faits de la période en code (alertes ouvertes, retours par canal dont sujets connus, tendances émergentes, nouveaux insights, mouvements de rang, comptes à risque, décisions en attente dont fusions et scissions), rédaction par Signal (skill `digest`) vérifiée en code, ordre fixe, « Pas encore d'historique » imposé au premier classement, repli sur un rendu brut si la rédaction échoue. Stockage dans `digests` et `po_state.last_digest_id`.
- Nœud `digest` en fin de graphe ; `pnpm digest` ; `GET /api/cron/digest` (Bearer `CRON_SECRET`) : incrémental sur les retours non traités par lots de 10 dans 200 s, puis digest. `vercel.json` : cron quotidien, région `dub1`.
- Vérifié en réel : premier digest avec S7 (I-29) émergent, Studio Bastide, Atelier Mercure, Groupe Hélix (+ Clim'Ouest) à risque, sans historique ; route refusée sans secret, second digest avec historique.
- Enchaînée dans la même session que 2.6, à la demande du PO. Correction au passage d'un test instable (`8001d0f`).

## [2.6] Le pipeline en graphe LangGraph — 2026-10-03

`7e462c1` · ADR-013

- `src/pipeline/graph.ts` : StateGraph ingest → triage (fan-out par lots via `Send`) → enrich → embed → cluster → estimate → score → alert. État minimal (ID, stats, coûts), nœuds idempotents, une nouvelle tentative par nœud, un span Langfuse par nœud sous la trace du run. Checkpointer Postgres (schéma `langgraph`) pour `--resume`.
- `src/pipeline/lock.ts` : verrou `pg_try_advisory_lock` pour toute la durée d'un run ; un second run attend 30 s puis abandonne (« Run en cours, réessaie dans un instant. »).
- `src/pipeline/incremental.ts` : 1 à 10 retours → triage, rattachement à l'insight le plus proche ou file « à surveiller », nouvel insight « propose » à 3 items proches, re-score des insights touchés (jugement stocké, calculs en code), alertes ; la réponse dit, par retour, ce qu'il est devenu.
- `src/pipeline/nodes/alert.ts` (code pur) : seuils de SPEC §10.10, une alerte par sujet et par type sur 24 h, les suivantes l'enrichissent.
- Migration `0004` : `scores.judgment`. `pnpm pipeline:run [--resume <run_id>]`, `pnpm pipeline:reset --yes`, `POST /api/pipeline/incremental`, `GET /api/pipeline/runs`. Graphe Mermaid dans `docs/ARCHITECTURE.md` (testé).
- Vérifié en réel : base remise à zéro, run tué à 68/214 retours triés puis repris sans retrier (301 s, 1,22 €), run concurrent refusé ; S1 → I-27 ; trois retours « interface en espagnol » → I-50 + alerte `nouveau_sujet` ; Groupe Hélix : alerte `churn` créée puis enrichie. Latence de l'incrémental au-dessus du budget (voir Points d'attention).

## [2.5] Scoring RICE hybride, robustesse, alignement, MoSCoW — 2026-10-03

`89e8fa8` · ADR-012

- `src/lib/scoring/` (sans LLM, couvert à 100 %) : Reach en comptes distincts (modes comptes et MRR, retour sans compte, prospects, insight manuel), Confidence, Effort, RICE avec overrides et départage des égalités, robustesse du top 5, règles MoSCoW dans l'ordre avec tensions, capacité, validation des overrides et « contexte modifié ».
- `src/pipeline/nodes/score.ts` (Sonnet) : un jugement par insight classé — Impact, justification, 2 à 5 preuves limitées aux retours de l'insight, contradictions, alignement et OKRs, recommandation MoSCoW. Le modèle ne produit aucun score. Effort par l'estimation en cache, calculs, rang et nouvelle version dans `scores`.
- Migration `0003` : `overrides.feedback_ids`, `scores.overridden`.
- `pnpm pipeline:score [--reach-mode comptes|mrr]` : en mode comptes, le Gantt (I-01) passe devant les permissions (I-07) ; en MRR, l'inverse. I-07 Must (engagement Atelier Mercure, J+75) ; I-11 (S4) hors stratégie, Won't. Must à 27 % de la capacité. 0,66 € le premier run, 0,15 € ensuite.
- Checklist validée par le PO (`e6fe09f`). Étapes 2.4 et 2.5 enchaînées dans la même session, à sa demande.

## [2.4] Estimation par analogie — 2026-10-03

`922b33a` · ADR-011

- `src/lib/estimation/reference.ts` (sans LLM) : les 3 tickets livrés les plus proches (cosinus, sur un jeu de tickets passé en paramètre pour le leave-one-out), analogue proche à partir de 0,45, biais de l'équipe (points réels ÷ estimés, au moins 3 tickets), correction et élargissement sur l'échelle de Fibonacci, T-shirt.
- `src/services/estimate.ts` : un seul appel Sonnet structuré (skill `estimation` + `architecture.md` en préfixe mis en cache, besoin dans `wrapExternal()`). Composants limités aux modules de la carte, analogies limitées aux tickets fournis, revalidées en code. Correction de biais et élargissement sans analogue proche (confiance forcée à basse, signalée) faits par le code. Cache par `problem_hash`. `estimateBacklogItems` : une passe pour tous les éléments d'un insight.
- `pnpm estimate "<besoin>" | I-xx [--force]` : permissions et invités 13–21 (L–XL) ; notifications d'assignation 3–5 (M) ; suivi du temps 5–21, confiance basse, signalé ; seconde estimation de I-07 depuis le cache (1 s, 0 €). ~0,025 € par estimation.

## [2.3] Regroupement par problème, stabilité et tensions — 2026-10-03

`510de24` · ADR-010

- `src/pipeline/nodes/embed.ts` : un vecteur par item, « problème sous-jacent — résumé » (jamais le texte brut) ; éloges, questions et `autre` jamais regroupés.
- `src/lib/clustering/agglomerative.ts` : clustering agglomératif average linkage, cosinus, déterministe. Seuil 0,28 réglé sur les données (partition identique de 0,27 à 0,29).
- `src/pipeline/nodes/match.ts` : appariement entre runs (Jaccard ≥ 0,5, puis centroïdes ≥ 0,9), fusion (`merged_into`), scission (l'ID reste à la plus grosse part), dissolution ; statut, titre verrouillé, overrides et backlog conservés ; un rejeté reste rejeté ; une fusion est rejouée en code au run suivant.
- `src/pipeline/nodes/label-insights.ts` (Sonnet) : titre formulé comme un problème, énoncé, demandes exprimées (fréquences comptées en code, ID vérifiés), passe de consolidation, passe de tensions. `src/lib/insights/aggregates.ts` : comptes distincts, MRR, renouvellements, segments, canaux, tendance, classement. `commitments.md` dit quel domaine couvre chaque engagement.
- `pnpm pipeline:cluster [--threshold X]` : 25 insights, 0,23 €. S1 en un insight sur 4 canaux ; S3 titré « Rendre compte de l'avancement au client » ; S5a/S5b reliés par une tension ; S7 émergent. Second run : mêmes ID, aucun appel au modèle.

## [2.2] Rattachement client et signaux business — 2026-10-03

`67ac23d` · ADR-009

- `src/pipeline/nodes/enrich.ts` (sans LLM) : compte connu, sinon domaine de l'e-mail (jamais une messagerie grand public ni `jalon.fr`), sinon nom de compte cité dans une note interne (exact, cœur du nom, puis approché), sinon aucun. Signaux par retour : plan, segment, MRR, jours avant renouvellement, prospect, poids de la source, `account_key` pour compter les comptes distincts.
- Seed rendu réaliste (décision du PO) : seuls les commentaires in-app et les NPS arrivent avec leur compte.
- `pnpm pipeline:enrich` : 214/214 retours rattachés comme prévu par le plan ; S2b sur les bons comptes, S4 sur le prospect Forgeval, E7 sans compte, relances E2 sous une seule clé.

## [2.1] Triage des retours — 2026-10-03

`75b596c` · ADR-008

- `src/pipeline/nodes/triage.ts` : un appel Haiku structuré par retour (langue, sentiment, urgence, churn, injection, confiance, puis 1 à 3 items avec type, domaine, tags, demande exprimée, problème sous-jacent, résumé, fonctionnalité existante). Skill `triage-taxonomy` et `product.md` en préfixe mis en cache ; retour encapsulé par `wrapAsData()` ; texte tronqué à 6 000 caractères (début et fin) pour le modèle, `raw_text` intact.
- `pnpm pipeline:triage [--model haiku|sonnet] [--sample N] [--run-id X] [--retry-failed] [--concurrency N]` : 8 appels en parallèle, échecs marqués `failed` sans arrêter le run, run suivi dans `pipeline_runs` (durée, tokens, coût, trace Langfuse).
- Run complet : 214 retours, 0 échec restant, ~1 min 30, 0,26 €. S6 signalé (R-144) sans faux positif ; E1 → 2 items ; E3 en français ; E4 `autre` ; E5 `existing_feature`. Accord avec la vérité terrain : type 210/222, domaine 202/222.
- Couche LLM corrigée : enums imposés dans le schéma strict, nouvelle tentative guidée par les erreurs de validation.

## [1.4] Scénario maître, cas limites, jeu réservé — 2026-10-03

`714381d` · ADR-006, ADR-007

- `data/scenario.yaml` : SPEC §5 en configuration (patterns S1 à S7, bruit en petits sujets sous le seuil de classement, cas limites E1 à E8, volumes du jeu réservé).
- `scripts/lib/feedback-plan.ts` planifie chaque retour à seed fixe ; **le plan est la vérité terrain**. Le modèle n'écrit que l'objet et le texte (`scripts/generate-feedbacks.ts`, lots de 10, contrôles et nouvelles tentatives, cache, mode `--preview`).
- Sorties : `data/feedbacks.json` (214 retours, sans étiquette), `evals/ground-truth/feedbacks.gt.json`, `evals/holdout/` (77 retours et leur vérité).
- Relecture humaine : exemples S1, S3, E1 validés avant la génération ; corrections après relecture (angles recopiés mot pour mot, risque de départ inventé par le modèle, tons incohérents, sentiment des multi-sujets).
- `pnpm db:seed` insère les retours (`received_at` relatif à `DEMO_NOW`, heures de bureau à Paris). `scripts/review-sample.ts` sort l'échantillon de relecture.
- Règle 4 outillée : règle ESLint et test qui interdisent à `src/` de lire `evals/ground-truth` ou `evals/holdout`.

## [1.3] Clients, prospects, tickets de référence — 2026-10-02

`022d20a` · ADR-005

- `data/customers.csv` : 90 clients + 5 prospects générés sans LLM (seed fixe), comptes sensibles de SPEC §4.5 exacts, aucun domaine e-mail grand public.
- `data/reference_tickets.json` : 40 tickets T-101 à T-140. Chiffres planifiés en code (biais réel ÷ estimé : permissions 1,65, export 1,69, notifications 1,03, autres 1,10 à 1,28) ; textes écrits par le modèle ; tickets cités par SPEC et les skills (T-108, T-112, T-117, T-121, T-124) écrits à la main.
- Relecture : chronologie corrigée (assignation multiple avant T-108, rôle admin à partir de T-117) ; `product.md` complété des fonctionnalités livrées par les tickets.
- Migration `0002` : `sync_id_sequence` recale les séquences après un seed à ID explicites (règle la dette de 0.2). `pnpm db:seed` idempotent.
- `src/lib/demo-now.ts` : toutes les dates relatives à `DEMO_NOW`.

## [1.2] Skills — 2026-10-02

`d9d2807`

- 9 skills dans `context/jalon/skills/` (triage-taxonomy, rice-scoring, moscow, backlog-format, user-story, estimation, challenge, digest, prototype) : règles, gabarit, bon et mauvais exemple, erreurs fréquentes.
- `src/lib/skills.ts` : `listSkills()` et `loadSkill(name)` ; un nom hors de l'index est refusé (l'agent ne peut pas lire un autre fichier).

## [1.1] Pack de contexte — 2026-10-02

`69ef142` · ADR-004

- `context/jalon/` : produit (avec la liste des fonctionnalités existantes, pour CL-05), stratégie et OKRs, personas, équipe et capacité, carte d'architecture (8 modules à identifiants stables, couplage, dette), engagements, glossaire.
- `weighting.yaml` : tous les paramètres et seuils de §8 et §10.10, validés par un schéma zod strict ; `src/lib/context.ts` : `loadContextPack()`.

## [0.3] Couche LLM, embeddings, observabilité — 2026-10-02

`4ba4445` · ADR-003

- `src/lib/llm/` : `getModel(role)` (modèles uniquement dans `models.ts`), `invokeStructured()` (validation zod, 1 nouvelle tentative, erreur typée), coûts en code (`cost.ts`, `RunCost`), `wrapAsData` / `wrapExternal` (anti-injection), `buildCachedSystem` (cache de prompt), `tracing.ts` (OpenTelemetry + Langfuse).
- `src/lib/embeddings/` : Voyage `voyage-4`, 1024 dimensions, lots et nouvelles tentatives.
- Traçage : une trace par unité de travail (`withTrace`), session = run, générations et embeddings avec modèle, tokens, coût. Trace auditée selon les bonnes pratiques Langfuse.
- Garde-fou ESLint : aucun import de SDK de modèle hors de `src/lib/llm`.
- Skill Langfuse installée pour Claude Code (`.claude/skills/langfuse`).
- Vérification : `pnpm tsx scripts/smoke-llm.ts`.

## [0.2] Schéma Supabase — 2026-10-02

`adcb6bc` · ADR-002

- `supabase/migrations/0001_init.sql` : 24 tables de SPEC §7, enums Postgres, identifiants lisibles générés en base (`R-001`, `I-01`, `US-001`…), `vector(1024)` + HNSW cosinus, bucket privé `prototypes`.
- Accès serveur uniquement : RLS activée sans policy, clé service role. Clients `src/lib/db/client.ts` (app) et `script-client.ts` (CLI), types générés (`pnpm db:types`).
- Migration testée hors ligne sur PGlite (`src/lib/db/schema.test.ts`). Migrations en ajout seulement.

## [0.1] Squelette, CI, protection — 2026-10-02

`95fc959` · ADR-001

- Next.js 16 (App Router, `src/proxy.ts` à la place du middleware), Tailwind 4, shadcn/ui, Vitest, ESLint + Prettier, pnpm 12.
- Basic Auth sur `SITE_PASSWORD`, sauf `/api/cron/*`, `/api/notion/webhook`, `/api/mcp`.
- CI GitHub Actions, déploiement Vercel, `.env.example` complet (SPEC §16).
