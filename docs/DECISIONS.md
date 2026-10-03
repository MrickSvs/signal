# Décisions d'architecture

Gabarit ADR : copier le bloc ci-dessous pour chaque décision.

## ADR-XXX — Titre

- **Date** : AAAA-MM-JJ
- **Statut** : proposée | acceptée | remplacée
- **Contexte** : ce qui force à décider.
- **Décision** : ce qui est choisi.
- **Conséquences** : ce que cela implique, y compris les compromis.

## ADR-001 — Socle technique

- **Date** : 2026-10-02
- **Statut** : acceptée
- **Contexte** : étape 0.1, création du squelette.
- **Décision** : Next.js 16.3.8 (App Router, `src/proxy.ts` à la place de `middleware`), React 19.2, Tailwind 4, shadcn/ui (style base-nova, base neutral, composants Base UI), Vitest 5, ESLint 9 + Prettier, pnpm 12. Polices via le paquet `geist` (locales) plutôt que `next/font/google`, pour que le build ne dépende pas d'un accès réseau. Le script `typecheck` lance `next typegen` avant `tsc` (les types globaux comme `LayoutProps` sont générés). pnpm 12 fait échouer l'installation si un script de build n'est pas arbitré : `pnpm-workspace.yaml` autorise `esbuild` et refuse `sharp` et `unrs-resolver`.
- **Conséquences** : la Basic Auth du proxy s'exécute sur le runtime Node (comparaison en temps constant). Les routes `/api/cron/*`, `/api/notion/webhook` et `/api/mcp` en sont exclues via le `matcher` et devront vérifier leur propre secret.

## ADR-002 — Schéma Supabase, dimension d'embedding et accès

- **Date** : 2026-10-02
- **Statut** : acceptée
- **Contexte** : étape 0.2. La dimension des colonnes `vector` est figée dans la migration ; en changer impose une nouvelle migration et un recalcul de tous les embeddings.
- **Décision** :
  - **Dimension 1024.** La doc Voyage (vérifiée le 2026-10-02) donne 1024 comme dimension par défaut de toute la série actuelle (`voyage-4-large`, `voyage-4`, `voyage-4-lite`) comme de `voyage-3.5` cité par le plan. Le choix du modèle se fait à l'étape 0.3 sans toucher au schéma. Index HNSW en distance cosinus (`vector_cosine_ops`).
  - **Identifiants lisibles** générés en base : une séquence par entité et `format_readable_id(prefix, n, largeur)`, qui ne tronque jamais au-delà de la largeur (R-999 → R-1000). Les items (`R-042.1`) sont une colonne générée à partir de `feedback_id` et `item_index`. Les éléments du backlog reçoivent `US-`, `BUG-` ou `TT-` par trigger selon `kind`, chacun avec sa propre séquence. Les tickets de référence démarrent à `T-101`.
  - **Enums Postgres** pour toutes les valeurs listées en SPEC §7 (types TypeScript générés en unions). Une valeur nouvelle passe par `alter type … add value` dans une nouvelle migration.
  - **Accès serveur uniquement.** RLS activée sur toutes les tables sans aucune policy, droits retirés à `anon` et `authenticated` : la clé publique ne lit rien, la clé service role passe outre la RLS.
  - Choix non précisés par SPEC : `feedback_analyses` a pour clé `(feedback_id, run_id)` ; `pipeline_runs.status` ∈ `en_cours` / `termine` / `echec` ; une seule ligne `scores.is_current` et un seul override actif par paramètre (index uniques partiels) ; un bug ne peut pas avoir d'epic (contrainte) ; le dossier d'alerte est stocké en `dossier` (jsonb) et `dossier_markdown`.
- **Conséquences** : la migration est testée sans réseau sur PGlite + pgvector (`src/lib/db/schema.test.ts`), avec des substituts pour les objets propres à Supabase (rôles, schéma `extensions`, `storage.buckets`). Le CLI Supabase est une devDependency du projet.

## ADR-003 — Couche LLM, embeddings et traçage Langfuse

- **Date** : 2026-10-02
- **Statut** : acceptée
- **Contexte** : étape 0.3. Un seul point d'entrée pour les appels LLM, tracés et chiffrés dès le premier jour. Docs consultées le 2026-10-02 : Langfuse (intégration LangChain JS, SDK TypeScript, bonnes pratiques de trace), `@langchain/anthropic`, référence de l'API Claude, API d'embeddings Voyage.
- **Versions** : `@langchain/anthropic` 1.5.12, `@langchain/core` 1.2.14, `langchain` 1.5.15, `@langfuse/tracing` · `otel` · `langchain` · `client` 5.11.1, `@opentelemetry/sdk-node` 0.222.0, `@anthropic-ai/sdk` 0.122.0 (uniquement pour `transformJSONSchema`), `zod` 4.6.5. Embeddings : Voyage `voyage-4`, 1024 dimensions, API REST.
- **Décision** :
  - **Températures** : Sonnet 5.5 et Opus 5.5 rejettent toute `temperature` différente de la valeur par défaut (400 côté API, erreur levée par `@langchain/anthropic` avant l'envoi). Seul le triage (Haiku) garde `temperature: 0`. Les rôles `reasoning` (0,2), `agent` (0,3), `judge` (0) et `generation` (0,9) prévus par PLAN 0.3 ne sont pas applicables : ces rôles tournent en réflexion adaptive avec `display: "summarized"` (raisonnement visible dans les traces, même facturation). La variété de la génération passera par le prompt ; la stabilité du juge par sa calibration (étape 6.3).
  - **Sorties structurées natives** (`output_config.format`, schéma transformé par `transformJSONSchema`) plutôt que `withStructuredOutput` en appel d'outil forcé : `tool_choice` forcé renvoie une 400 sur Sonnet 5.5 et Opus 5.5. Le modèle est appelé directement, ce qui donne une seule génération nommée dans la trace au lieu de six spans internes de LangChain. Validation zod en code, une nouvelle tentative, puis `StructuredOutputError` typée (`api` ou `validation`). Les erreurs réseau, 429 et 5xx sont déjà retentées par le SDK (`maxRetries: 2`).
  - **Traçage** : OpenTelemetry (`NodeSDK`, `serviceName: "signal"`) + `LangfuseSpanProcessor`, initialisé dans `src/instrumentation.ts` pour l'app et par `initTracing()` dans les scripts (qui finissent par `shutdownTracing()`). Sans clés Langfuse (tests, CI), rien n'est enregistré. Une trace par unité de travail (`withTrace` : run, nœud, tour d'agent) avec `sessionId` = run_id, métadonnées `run_id`, `step`, `entity` ; noms d'observations stables, verbe d'abord ; environnement `LANGFUSE_TRACING_ENVIRONMENT` → `VERCEL_ENV` → `development` ; release = commit Vercel. Dans une route, `flushTracing()` dans `after()`. Les embeddings sont tracés comme observations `embedding` avec modèle, tokens et coût.
  - **Coûts** : calculés en code (`cost.ts`) à partir de l'usage brut Anthropic (cache 5 min et 1 h distingués), prix vérifiés le 2026-10-02, conversion au taux BCE du jour (1 € = 1,1225 $). `RunCost` agrège un run (euros, tokens entrée et sortie).
  - **Cache de prompt** : `buildCachedSystem` place un seul point de cache sur le dernier bloc stable. Le préfixe minimal est de 4 096 tokens sur Haiku 4.5 (512 sur Sonnet 5.5 et Opus 5.5) : pour que le triage profite du cache, son préfixe (skill + product.md) devra dépasser ce seuil, à vérifier à l'étape 2.1.
  - **Garde-fou** : règle ESLint `no-restricted-imports` sur `@langchain/anthropic` et `@anthropic-ai/sdk` hors de `src/lib/llm`.
- **Conséquences** : les retours de type refus (`stop_reason: "refusal"`) aboutissent à un échec de validation puis à `failed` ; le repli automatique côté serveur (`fallbacks`) n'est pas activé, à reconsidérer si des refus apparaissent au triage ou dans l'agent. Le compte Langfuse étant récent, la lecture des traces passe par l'API `v2/observations` (l'ancienne API `traces` est fermée aux nouvelles organisations).

## ADR-004 — Pack de contexte : format et chargement

- **Date** : 2026-10-02
- **Statut** : acceptée
- **Contexte** : étape 1.1. Le pack (`context/jalon/`) est lu par le pipeline, l'agent et l'écran Contexte ; ses paramètres pilotent tous les calculs de §8.
- **Décision** :
  - **Identifiants de modules** : SPEC §4.3 ne donne que des libellés. Le tableau « Modules » d'`architecture.md` fixe des slugs stables (`taches`, `tableau`, `liste`, `notifications`, `permissions`, `export`, `champs_personnalises`, `parametres`), avec leur couplage. `loadContextPack()` les extrait (`modules`) : ce sont les composants autorisés de `reference_tickets.components` et des estimations.
  - **`weighting.yaml`** parsé par `yaml` 2.9.1 et validé par un schéma zod strict (clé inconnue refusée, poids de Confidence de somme 1, niveaux et échelles ordonnés, ordre MoSCoW complet). Il contient aussi les seuils d'alerte de §10.10 et la capacité (développeurs, semaines, part roadmap) : les 42 semaines-personne sont calculées en code.
  - Lecture disque à l'exécution depuis `process.cwd()/context/jalon` ; `outputFileTracingIncludes` embarque le pack dans les fonctions Vercel.
- **Conséquences** : renommer un module impose de régénérer les tickets de référence. Changer de plans tarifaires demande d'adapter le schéma zod.

## ADR-005 — Données de référence : chiffres planifiés en code, dates relatives

- **Date** : 2026-10-02
- **Statut** : acceptée
- **Contexte** : étape 1.3. Les tickets de référence doivent porter des biais d'équipe mesurables (permissions et export sous-estimés, notifications bien estimées) et rester cohérents avec les tickets déjà cités dans SPEC §9 et les skills.
- **Décision** :
  - **Clients** générés sans LLM, à seed fixe (`scripts/lib/random.ts`, mulberry32), ID attribués après mélange. Les comptes de SPEC §4.5 et les 2 comptes Business du sujet permissions sont fixés dans le script (`SCENARIO_ACCOUNTS`). Les prospects n'ont ni plan, ni MRR, ni santé ; leurs sièges sont des sièges potentiels. Les autres comptes Enterprise renouvellent au-delà de 90 jours.
  - **Tickets** : module, composants, points estimés et réels, durée (≈ 5/3 jour par point, ± 20 %) et date de livraison sont planifiés en code ; le rôle `generation` n'écrit que titre, description et surprises, à partir d'un thème par ticket, avec contrôles (sujets du scénario interdits, dates absolues, longueurs) et nouvelle tentative. Les tickets cités dans le contexte sont écrits à la main. Relecture humaine ensuite : chronologie corrigée (assignation multiple avant T-108, rôle admin seulement à partir de T-117).
  - **Dates** : les fichiers stockent des décalages (`renewal_in_days`, `shipped_days_ago`) ; le seed les convertit à partir de `DEMO_NOW` (`src/lib/demo-now.ts`).
  - **Séquences** : migration 0002, `sync_id_sequence(entity)` recale la séquence d'une entité sur le plus grand ID présent, sans jamais reculer. Exécutable par `service_role` seulement.
  - **Seuil d'analogue proche** : 0,45 (et non 0,6) d'après les similarités mesurées sur voyage-4.
- **Conséquences** : régénérer les tickets écrase les corrections de relecture faites dans le JSON (sauf celles reportées dans le plan) ; le test du fichier versionné vérifie qu'il suit toujours le plan.

## ADR-006 — Volume du jeu de développement : bruit ramené à ~100

- **Date** : 2026-10-02
- **Statut** : acceptée (décision du PO avant l'étape 1.4)
- **Contexte** : le jeu de développement prévoyait ~265 retours dont ~140 de bruit. Les volumes des patterns créent les contrastes visibles en démo (Gantt contre permissions, quatre canaux de S1, pic de S7) ; au-delà d'environ 100, le bruit n'ajoute rien de visible mais alourdit chaque run du pipeline.
- **Décision** : volumes des patterns et des cas limites inchangés, bruit à ~100, total ~225 retours sur 6 semaines ; jeu réservé maintenu à ~80. SPEC §1 dit désormais « plus de 150 retours par mois » (225 sur 6 semaines).
- **Conséquences** : ~15 % de coût et de durée en moins par run complet ; les signaux faibles restent nombreux (petits regroupements plantés dans le bruit).

## ADR-007 — Jeu de retours : le plan est la vérité terrain

- **Date** : 2026-10-03
- **Statut** : acceptée
- **Contexte** : étape 1.4. La vérité terrain des evals (§14.2) doit être exacte et ne jamais dépendre de ce que le modèle a « voulu » écrire.
- **Décision** :
  - `data/scenario.yaml` traduit SPEC §5 ; `scripts/lib/feedback-plan.ts` planifie chaque retour à seed fixe (pattern, canal, compte, auteur et e-mail, jours avant `DEMO_NOW`, langue, ton, fautes, note NPS, churn, injection, items attendus, cas limites). Le rôle `generation` n'écrit que l'objet et le texte, par lots de 10 (fils longs à part), 4 lots en parallèle. Les volumes comptent des items : un retour E1 porte deux items.
  - Contrôles du texte en code, avec nouvelle tentative : identifiants de pattern, dates absolues, jours, mois, années, objet selon le canal, langue, longueur des fils E6, phrase d'injection, et **aucune reprise mot pour mot de l'angle de la fiche** (6 mots consécutifs), pour ne pas planter de mot-clé commun entre retours d'un pattern (§5.4).
  - Cache des textes dans `.cache/feedback-texts/` (ignoré par git), indexé par le retour planifié et le prompt ; les textes en cache sont revalidés. Une régénération ne paie que ce qui a changé.
  - Vérité terrain : schéma de PLAN 1.4 plus `topic` (sujet de bruit), `acceptable_areas` (domaine ambigu, sur le modèle de `acceptable_types`) et `churn_signal`. Sentiment d'un E1 : le sujet nettement négatif l'emporte, sinon somme des deux tons.
  - Garde-fous de la règle 4 : `no-restricted-syntax` ESLint sur les chemins `evals/ground-truth` et `evals/holdout` dans `src/`, et un test qui parcourt `src/` (chemins découpés compris).
  - `received_at` = `DEMO_NOW` − `days_ago`, à une heure de bureau à Paris stable par retour ; un retour du jour n'est jamais dans le futur.
- **Conséquences** : modifier un angle du jeu de développement invalide tout le cache du jeu réservé (son prompt liste ces angles pour les éviter). Le test des fichiers versionnés échoue tant que les fichiers ne suivent plus le plan : il faut régénérer.

## ADR-008 — Triage : une passe par retour, enums imposés, correction guidée

- **Date** : 2026-10-03
- **Statut** : acceptée
- **Contexte** : étape 2.1. Trier ~215 retours avec Haiku de façon reproductible, peu chère et sans bloquer le run sur un échec (CL-11).
- **Décision** :
  - **Un appel structuré par retour** (`src/pipeline/nodes/triage.ts`) : niveau retour + 1 à 3 items. Préfixe système en cache, dans un ordre fixe : consigne, skill `triage-taxonomy`, `product.md` (~5 900 tokens, au-dessus du minimum de 4 096 de Haiku : vérifié, 1 043 436 tokens lus en cache sur le run complet). Le message utilisateur porte les métadonnées (canal, source, compte, note NPS, troncature) puis le retour dans `wrapAsData()`, objet compris.
  - **Troncature (CL-06)** : seul le texte envoyé au modèle est tronqué (moitié début, moitié fin, marqueur du nombre de caractères coupés, 6 000 caractères au plus d'après `weighting.yaml`). `raw_text` reste intact en base, puisque c'est la preuve ; `feedbacks.truncated` passe à `true`.
  - **Écriture idempotente** : `feedback_analyses` en upsert par (feedback_id, run_id) ; en cas de succès, les items du retour sont remplacés (upsert par (feedback_id, item_index), puis suppression des index en trop) et `feedbacks.language` est renseignée. Un échec garde les items précédents. `feedback_items` n'ayant pas de `run_id`, un nouveau triage remplace les items.
  - **Sélection** : retours sans analyse `ok` ; ceux en échec seulement avec `--retry-failed`. `--sample N` prend N retours répartis sur toute la plage d'ID (déterministe). `--model sonnet` utilise le rôle `reasoning`.
  - **Robustesse** : 8 appels en parallèle ; les erreurs d'API, déjà retentées par le SDK, ont une seconde série de tentatives (2 s puis 4 s) ; échec définitif → analyse `failed` avec l'erreur, le run continue. Une erreur d'écriture en base arrête le run (statut `echec`).
  - **Correction de la couche LLM (0.3)** : `transformJSONSchema` (SDK 0.122) relègue `enum` en description, donc les enums n'étaient pas imposés par le décodage contraint (1 domaine inventé sur 40). `toStrictJsonSchema()` les remet en place. La nouvelle tentative après une sortie invalide renvoie désormais au modèle sa réponse et les erreurs zod : le même prompt redonnait la même erreur (résumé de 21 mots).
  - Le résumé est limité à 20 mots en code (refine zod) ; tags normalisés en code (minuscules, sans doublon, sans le domaine).
- **Conséquences** : un run complet coûte ~0,27 € et dure ~1 min 30. Les 8 premiers appels écrivent le cache en parallèle (surcoût de quelques centimes, non optimisé). Lancé seul, `pipeline:triage` enregistre son run en `kind = full` avec `stats.step = "triage"` ; le graphe de 2.6 reprendra la gestion des runs.
