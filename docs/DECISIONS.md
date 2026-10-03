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
