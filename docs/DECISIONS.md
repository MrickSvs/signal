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

## ADR-009 — Rattachement aux comptes : seed réaliste, signaux calculés à la demande

- **Date** : 2026-10-03
- **Statut** : acceptée
- **Contexte** : étape 2.2. Le seed chargeait le `customer_id` planifié pour 203 retours sur 214, notes internes comprises, alors que seuls les utilisateurs connectés (commentaires in-app, NPS) ont un compte connu d'office (SPEC §4.2). Le rattachement n'aurait rien eu à faire.
- **Décision** (validée par le PO) :
  - **Seed réaliste** : `customer_id` n'est chargé que pour `commentaire_in_app` et `nps`. Les e-mails, tickets et notes internes arrivent sans compte. Le compte planifié reste dans `data/feedbacks.json` et sert à mesurer le rattachement. La langue n'est plus chargée non plus : c'est le triage qui la renseigne. Relancer `db:seed` remet donc ces `customer_id` à `null` : il faut relancer `pipeline:enrich` derrière (le graphe de 2.6 le fera).
  - **Rattachement** (`src/pipeline/nodes/enrich.ts`, code pur), dans l'ordre : compte déjà connu ; domaine de l'e-mail, sauf messageries grand public (liste fermée) et `jalon.fr` ; pour une note interne seulement, nom de compte cité dans l'objet ou le texte, en correspondance exacte (nom complet ou cœur du nom sans mots génériques : « Kiosque » pour Agence Kiosque, « Forgeval Indus. » pour Forgeval Industrie), puis approchée (distance d'édition de 1, ou 2 au-delà de 8 caractères, pour les noms d'au moins 7 caractères), en préférant la première citation ; sinon aucun compte.
  - **Clé de comptage** `account_key` : `customer_id`, sinon `email:<adresse>`, sinon `auteur:<nom normalisé>`. Une note interne sans compte compte seule (`retour:<id>`) : son auteur est un CSM qui relaie plusieurs clients.
  - **Signaux non stockés** : le schéma (§7) n'a pas de colonnes pour plan, segment, MRR, renouvellement, prospect ou poids de source. Ils sont recalculés à la demande depuis `customers` et `weighting.yaml` (`computeSignals`), ce qui leur évite d'être périmés quand un compte change. Seul `customer_id` est écrit, et seulement s'il manquait.
- **Conséquences** : le rattachement atteint 214/214 sur le jeu de développement (92 par domaine, 12 par nom dans les notes, 11 sans compte). Les noms courts ne sont reconnus qu'à l'identique ; un nom commun cité tel quel dans une note interne (« Rivage », « Trame ») pourrait rattacher à tort.

## ADR-010 — Regroupement par problème : seuil mesuré, appariement entre runs et mémoire des fusions

- **Date** : 2026-10-03
- **Statut** : acceptée
- **Contexte** : étape 2.3. Regrouper les items sur leur problème (SPEC §6.1, ADR 010 et 011 de SPEC §6.5), garder les mêmes ID d'un run à l'autre (CL-14) sans perdre les décisions du PO (CL-51, CL-53), et ne laisser au modèle que le jugement (P5).
- **Décision** :
  - **Vecteur** : « problème sous-jacent — résumé » de chaque item (`src/pipeline/nodes/embed.ts`), jamais le texte brut. Le triage remet l'embedding d'un item à `null` quand il le réécrit. Les items `eloge`, `question` et `autre` ne sont pas regroupés (CL-04).
  - **Clustering** (`src/lib/clustering/agglomerative.ts`) : agglomératif, average linkage (Lance-Williams), distance cosinus, déterministe (égalités départagées par les indices). **Seuil 0,28**, mesuré sur le jeu de développement contre la vérité terrain (hors `src`) : la partition est identique de 0,27 à 0,29 ; dès 0,29 l'agenda (bruit) rejoint le Gantt, dès 0,31 S4 rejoint S3, dès 0,32 S5a et S7 se mêlent, tout fusionne à 0,35 ; à 0,25 S3 se coupe en deux. Les distances voyage-4 sont tassées : la valeur initiale de 0,35 mélangeait tout.
  - **Appariement** (`src/pipeline/nodes/match.ts`, code pur) : Jaccard des items ≥ 0,5, puis centroïdes ≥ **0,9** (nouvelle clé `run_matching_centroid_similarity` ; mesuré : centroïdes de groupes distincts ≤ 0,83, sous-ensemble d'un même groupe ≥ 0,94). Affectation gloutonne un pour un, ordre déterministe. Un insight existant dont la majorité des items est dans un groupe resté sans insight reprend ce groupe (le sujet a grossi autour de lui). Fusion → l'absorbé passe `fusionne` avec `merged_into` ; scission → l'ID reste à la plus grosse part ; insight dissous → `archive` (un `rejete` reste `rejete`). Statut, `title_locked`, overrides et backlog suivent l'ID. Fusions, scissions et dissolutions sont écrites dans `pipeline_runs.stats.events` pour le digest (2.7).
  - **Mémoire des fusions** : un insight `fusionne` garde ses `insight_items`, figés. Sans cette mémoire, une fusion décidée par la passe de consolidation (ou plus tard par le PO) serait défaite au run suivant : le clustering brut sépare de nouveau les deux groupes et un nouvel ID apparaît. Quand les items figés se reforment, la fusion est rejouée en code, sans appel au modèle. De même, un insight rejeté qui se dissout garde ses items, pour rester rejeté s'il se reforme. **Toute lecture des items d'un insight doit donc filtrer sur le statut** (`propose` / `actif`).
  - **Étiquetage** (`src/pipeline/nodes/label-insights.ts`, rôle reasoning) : seulement pour les insights nouveaux ou dont les items ont changé, jamais un rejeté. Skill `triage-taxonomy` en préfixe mis en cache (règle « problème vs solution ») ; 15 items représentatifs au plus (les plus proches du centroïde) et toutes les demandes exprimées, dans `wrapExternal()`. Le modèle regroupe les solutions en citant des ID d'items ; **le code vérifie les ID et compte les fréquences** (retours distincts). Un titre verrouillé n'est jamais réécrit (seuls le domaine et les demandes sont mis à jour). Un nouvel insight dont l'étiquetage échoue n'est pas créé : ses items attendent le run suivant (CL-11).
  - **Consolidation** : une passe propose des fusions ; le code n'accepte que celles qui impliquent un insight **nouveau** (deux insights existants ne sont fusionnés que par le PO), garde l'existant, sinon le plus gros, puis réétiquette le survivant. Un run sans nouveau groupe ne fait aucun appel.
  - **Tensions** : une passe sur les domaines qui ont au moins deux insights, avec la répartition des comptes par plan calculée en code ; paires du même domaine seulement. Relancée uniquement si un insight est nouveau ou réétiqueté ; les tensions entre insights inchangés sont conservées telles quelles.
  - **Agrégats et classement** (`src/lib/insights/aggregates.ts`) : comptes distincts par `account_key`, MRR et renouvellements à 90 jours des seuls clients, répartition par plan et segment, canaux, tendance de SPEC §8.8 (plancher à 1). Classé si 5 retours ou plus, OU signal de churn d'un compte Business/Enterprise, OU engagement contractuel, OU insight manuel ; jamais s'il est rejeté, fusionné ou archivé. **Engagement** : `commitments.md` gagne une colonne « Domaine » (`product_area`) lue par `parseCommitments()` ; un insight est couvert s'il est de ce domaine et contient un retour du compte engagé.
- **Conséquences** :
  - Premier run : 25 insights (11 classés), 78 s, 0,23 €. Second run sans nouvelle donnée : mêmes ID, mêmes items, même tension, 0 appel, ~25 s (écritures séquentielles).
  - Les écritures ne sont pas transactionnelles (supabase-js) : un échec au milieu de la phase d'écriture laisse un état partiel, que le run suivant recalcule. Tous les appels au modèle ont lieu avant la première écriture.
  - Trois petits sujets du bruit dépassent 5 retours en se regroupant légitimement (même problème, formulé par des sujets voisins du scénario) et sont classés. Décision du PO (2026-10-03) : accepté, `ranking.min_feedbacks` reste à 5.

## ADR-011 — Estimation par analogie : recherche en code, biais groupé, signalement sans migration

- **Date** : 2026-10-03
- **Statut** : acceptée
- **Contexte** : étape 2.4. Estimer l'effort comme une équipe produit (SPEC §8.4, ADR 002 et 009 de SPEC §6.5), en un seul appel structuré, avec un moteur réutilisable par l'éval leave-one-out (6.2) et sans laisser le modèle calculer (P5).
- **Décision** :
  - **Moteur sans base** (`estimateNeed`, `src/services/estimate.ts`) : il reçoit le besoin et le **jeu de tickets** en paramètre. La recherche des analogues est faite en code (`findReferenceTickets`, cosinus sur les 40 vecteurs chargés), pas par une fonction pgvector : le leave-one-out retire un ticket du jeu sans toucher à la base. Le besoin est vectorisé en `query` (les tickets le sont en `document`) sur « titre — description ».
  - **Contrat dans le schéma** : le schéma zod est construit à chaque appel. Les composants sont l'enum des modules d'`architecture.md`, les `ticket_id` l'enum des tickets fournis, les points dans Fibonacci. Le décodage contraint l'impose, la nouvelle tentative corrige, puis le code revalide la sortie : un composant inventé ou une analogie inventée font échouer l'estimation (`EstimationError`).
  - **Biais groupé** : facteur = moyenne des rapports points réels ÷ estimés des tickets **distincts** qui touchent au moins un des composants retenus. Pas de correction sous `bias_min_tickets` (3). Le facteur de chaque module est donné au modèle pour information seulement. Correction puis arrondi au Fibonacci le plus proche (égalité vers le haut), puis, sans analogue proche, élargissement (min ÷ 1,5 arrondi vers le bas, max × 1,5 vers le haut) et confiance forcée à « basse ».
  - **Signalement de CL-20 sans migration** : `complexity_estimates` n'a pas de colonne pour « aucun analogue proche ». Chaque analogie stockée porte sa similarité et `close`, et le code ajoute à la justification une phrase qui dit ce qu'il a fait (correction de biais avec la fourchette brute, élargissement avec la meilleure similarité). Le T-shirt est dérivé des points en code ; le modèle ne le produit pas.
  - **Cache** : clé `problem_hash` = sha256 de l'énoncé du problème (espaces et casse ignorés), par insight (`insight_id`, `item_id` nul) ou, pour un besoin libre, avec `insight_id` nul. Sans `force`, la dernière estimation trouvée revient sans appel au modèle ni à Voyage.
  - **Backlog** (`estimateBacklogItems`) : une passe pour tous les éléments d'un insight, une valeur Fibonacci (≤ 13) et des composants par élément. Contrôles en code : chaque élément une seule fois, un élément seul dans la fourchette de l'insight, plusieurs éléments chacun sous sa borne haute. Si la somme sort de la fourchette, elle est signalée avec l'explication du modèle. Une ligne `complexity_estimates` par élément (`item_id`) : les éléments doivent déjà exister dans `backlog_items` (étape 4.3).
- **Conséquences** :
  - Mesuré : une estimation coûte ~0,025 € et prend ~14 s (Sonnet en réflexion adaptive) ; 1 s depuis le cache.
  - Le biais groupé se dilue quand le modèle liste beaucoup de modules touchés par ricochet : les permissions seules valent × 1,65, mais « permissions + paramètres + export + tâches + liste + tableau » donne × 1,31 (33 tickets). La fourchette reste haute (13–21) parce qu'elle est déjà au plafond. À mesurer avec `eval:estimation` (6.2) avant de changer de règle (pondérer par module principal, ou prendre le facteur du composant le plus biaisé).
  - Seuil d'analogue proche confirmé à 0,45 : permissions 0,49–0,59, notifications 0,50–0,56, suivi du temps ≤ 0,37.

## ADR-012 — Scoring : le modèle juge, le code calcule, versionne et corrige

- **Date** : 2026-10-03
- **Statut** : acceptée
- **Contexte** : étape 2.5. Classer les insights de façon explicable (SPEC §8) sans qu'aucun chiffre ne vienne du modèle (P5, ADR 004 de SPEC §6.5), et garder les décisions du PO d'un run à l'autre (CL-22).
- **Décision** :
  - **Calculs** dans `src/lib/scoring/` (code pur, 100 % de couverture vérifiée par `pnpm test:coverage`) : Reach en comptes distincts (`account_key`, CL-02), 1 sans extrapolation pour un retour sans compte et 0 en MRR (CL-07), prospects à 0 (CL-08) ; Confidence (volume en comptes distincts, rétrogradation d'un niveau sur contradiction) ; Effort = milieu de la fourchette ÷ 3, ou Σ points du backlog ÷ 3 ; RICE comparé à 10⁻⁶ près pour que le bruit des flottants ne casse pas une égalité ; départage MRR, comptes, puis ID en ordre numérique (CL-21) ; robustesse du top 5 en rejouant le classement ; quartiles par rang ; capacité 5 × 12 × 0,7 = 42 semaines-personne.
  - **Jugement** (`src/pipeline/nodes/score.ts`, rôle reasoning) : un appel par insight classé (proposé ou actif). Les skills `rice-scoring` et `moscow`, `strategy.md` et `commitments.md` forment le préfixe mis en cache. Le code calcule les faits (comptes, MRR, engagements, comptes en churn, prospects, bugs critiques) et les donne au modèle ; l'insight et ses retours sont passés dans `wrapExternal()`. Le schéma est construit par insight : les preuves sont un enum des ID de **retours** de l'insight, les OKRs un enum des identifiants lus dans `strategy.md`, l'Impact une valeur de l'échelle ; justifications de 80 et 60 mots au plus. La sortie est revalidée en code.
  - **MoSCoW** : les cinq règles de la skill, quartiles compris, sont dures et appliquées dans l'ordre de `weighting.yaml`. La première règle qui s'applique fixe la catégorie. Une règle suivante qui donnerait une autre catégorie est une **tension** ; si elle donne la même, c'est un **renfort**. Les quartiles, règle par défaut, ne créent jamais de tension. Le code corrige la recommandation du modèle quand elle diffère et le note dans la justification et dans `rule_flags`. Piste écrite en code pour le seul cas de SPEC (hors stratégie contre churn : action CSM).
  - **Migration 0003** (ajout seulement) : `overrides.feedback_ids` garde les retours de l'insight au moment de l'override (CL-22 : contexte modifié au-delà de 30 % de retours ajoutés ou retirés) ; `scores.overridden` garde la valeur d'origine de chaque paramètre écrasé. Le MoSCoW final reste l'override `moscow` actif ; il compte dans la capacité.
  - **Versions** : chaque run écrit une nouvelle version par insight ; l'ancienne passe `is_current = false` d'abord (index unique). Un insight dont l'estimation ou le jugement échoue n'est pas rescoré : son score précédent reste tel quel et l'échec est listé (run, `pipeline_runs.stats.failures`).
  - **Embeddings** : les besoins de tous les insights sont vectorisés en un seul appel Voyage (3 requêtes/min sans moyen de paiement), puis les estimations tournent à 4 en parallèle.
- **Conséquences** :
  - Premier run (mode comptes) : 11 insights, 10 estimations et 11 jugements, 0,66 €. Run en mode MRR (estimations en cache) : 36 s, 0,15 €.
  - Le modèle reste non déterministe (Sonnet 5.5 sans température, ADR-003) : entre deux runs, l'Impact de I-01 est passé de 1 à 2 et une contradiction est apparue sur I-02 (Confidence 1 → 0,8). C'est l'objet de l'éval `stability` (6.2) ; aucune mise en cache du jugement pour l'instant.
  - Changer de mode Reach par la CLI rejuge tous les insights. L'écran Priorisation (3.5) devra recalculer en code à partir des jugements stockés, sans appel au modèle.
  - Le score précédent d'un insight en échec garde son ancien rang, qui peut alors doubler un rang du nouveau classement.

## ADR-013 — Pipeline en graphe : état minimal, verrou de session, incrémental sans rejugement

- **Date** : 2026-10-03
- **Statut** : acceptée
- **Contexte** : étape 2.6. Rendre le pipeline rejouable de bout en bout, robuste aux pannes (CL-11, CL-13), exclusif (CL-12), et ajouter un mode incrémental rapide (SPEC §6.1, §10.10, §15).
- **Décision** :
  - **Versions** : `@langchain/langgraph` 1.4.18, `@langchain/langgraph-checkpoint-postgres` 1.0.5, `pg` 8.23.
  - **Graphe** (`src/pipeline/graph.ts`, `Annotation.Root`) : ingest → triage (fan-out par lots de 10 via `Send`, `maxConcurrency` 2 × 4 appels) → enrich → embed → cluster → estimate → score → alert. L'état ne porte que des ID, des compteurs et des coûts ; chaque nœud relit en base ce qui reste à faire (idempotence). `cluster` réunit cluster, match et label : en 2.3, ils partagent un plan écrit après tous les appels de modèle. `retryPolicy` d'une nouvelle tentative par nœud. Le nœud `digest` arrive en 2.7.
  - **Reprise** : `PostgresSaver` dans un schéma `langgraph`, hors de l'API PostgREST (ses tables n'ont pas de RLS). `--resume <run_id>` repart du dernier checkpoint ; sans checkpoint, le run repart du début.
  - **Verrou** : `pg_try_advisory_lock` sur une connexion `pg` dédiée, interrogé chaque seconde pendant 30 s au plus. Une requête PostgREST ne peut pas tenir un verrou de session. `DATABASE_URL` doit être le **pooler en mode session** (port 5432, IPv4) : la connexion directe Supabase n'existe qu'en IPv6 (injoignable d'ici et depuis Vercel), et le mode transaction (6543) ne garde pas les verrous de session.
  - **Incrémental** : rattachement par similarité moyenne aux items de l'insight (même mesure et même seuil que l'_average linkage_ du run complet) ; un insight rejeté absorbe ses items et reste rejeté, un insight fusionné n'attire rien. File « à surveiller » regroupée au même seuil, nouvel insight `propose` dès 3 items. **Re-score sans rejugement** : migration 0004 (`scores.judgment`) ; le jugement stocké est réutilisé tant qu'il valide encore le schéma, et seuls les faits sont recalculés en code ; seul un insight sans jugement valide est jugé. Le run de nuit rejuge tout. Une nouvelle version n'est écrite que pour les insights touchés ou dont le résultat change.
  - **Alertes** : code pur. Sujet = l'insight, sauf `churn` = le compte (deux retours du même compte, sur deux sujets, enrichissent une seule alerte). `dedup_key` = `type|sujet|date de création`. Aucune alerte sur un premier run (base sans insight vivant) : tout y est nouveau, et c'est le digest qui en rend compte (CL-18, CL-52).
- **Conséquences** :
  - Run complet sur base remise à zéro : interrompu à 68/214 retours triés, repris avec `--resume` sans retrier, terminé en 301 s pour 1,22 € (plus ~40 s et ~0,1 € pour la tentative tuée, non comptés : un `SIGTERM` ne passe pas par la clôture du run). 24 insights, 10 classés. Un run concurrent est refusé après 30 s (code 2).
  - Incrémental, mesuré en local : 15 à 25 s par retour (triage Haiku 5 à 7 s, Voyage 1,5 à 2 s, chaque requête Supabase ~0,2 s depuis ici), 0,001 à 0,015 €. Un insight qui devient classé déclenche sa première estimation et son premier jugement : 48 s, 0,07 €. Le budget de 15 s de SPEC §15 n'est pas tenu ; à remesurer depuis Vercel en répétition (8.3).
  - Entre deux runs de nuit, l'Impact et l'alignement d'un insight ne bougent pas : un retour de plus change les faits (Reach, Confidence, MoSCoW par les règles dures, rang), pas le jugement.

## ADR-014 — Digest : faits en code, rédaction vérifiée, repli garanti

- **Date** : 2026-10-03
- **Statut** : acceptée
- **Contexte** : étape 2.7. Le digest est la scène d'ouverture de la démo (SPEC §12.2). Chaque chiffre doit porter un ID (P2, règle 9) et le digest ne doit jamais manquer, même si la rédaction échoue.
- **Décision** :
  - **Période** : depuis le digest précédent, ou depuis `po_state.last_seen_at` s'il est plus ancien ; aucun des deux → premier digest, tout est nouveau. Un retour est « nouveau » selon sa date d'entrée en base (`created_at`), pas sa date de réception du scénario ; les tendances restent sur 7 jours glissants relatifs à `DEMO_NOW` (§8.8).
  - **Faits** (`src/pipeline/nodes/digest.ts`, code pur) : alertes ouvertes ; retours de la période par canal, dont ceux rattachés à un insight qui existait avant la période (« confirment un sujet connu ») ; insights émergents avec leurs retours des 7 derniers jours ; nouveaux insights ; rang au début de la période (dernière version de score antérieure) contre rang courant ; comptes à risque ; décisions en attente (insights proposés, backlog en brouillon, conflits Notion, fusions et scissions des runs complets de la période, overrides au contexte modifié).
  - **Compte à risque** : client qui renouvelle dans moins de 90 jours (`moscow.horizon_days`) avec un signal de churn sur l'un de ses retours ou une santé rouge. Le sentiment négatif seul ne suffit pas : presque tous les comptes en ont.
  - **Rédaction** (rôle reasoning, skill `digest`) : le modèle écrit chaque section sans titre, plus trois recommandations au plus avec preuves et confiance. Le schéma zod refuse un ID absent des faits, une ligne chiffrée sans ID (hors J+n, OKR et numéros de liste), un jour de la semaine ou une date absolue, plus de 25 lignes ; une nouvelle tentative avec les erreurs, puis **repli** sur un rendu brut des faits (`writer = repli`, erreur stockée).
  - **Rendu** : le code assemble les sections dans l'ordre fixe et impose « Pas encore d'historique : c'est le premier classement. » quand aucun score n'existe avant la période (CL-18).
  - **Cron** : `GET /api/cron/digest` (`Authorization: Bearer $CRON_SECRET`, comparé à temps constant ; refusé sans secret configuré) prend le verrou du pipeline, absorbe les retours non traités par lots de 10 (mode incrémental) dans un budget de 200 s, puis rédige le digest (run `digest` dans `pipeline_runs`). `vercel.json` : `0 4 * * *` (6 h à Paris en heure d'été, 5 h en hiver ; un cron Hobby se déclenche dans l'heure) et `regions: ["dub1"]` (près de Supabase eu-west-1). Le graphe du run complet se termine aussi par le nœud `digest`.
- **Conséquences** :
  - Premier digest réel : S7 (I-29) émergent, les 3 comptes Enterprise à risque + Clim'Ouest (Business, santé rouge), « pas encore d'historique », 27 s, 0,04 €. Second digest (cron local) : période depuis le premier, aucun mouvement, 24 s, 0,02 €.
  - Les retours en échec de triage ne sont pas retentés par le cron ; le run complet (`pnpm pipeline:run`) le fait.
  - Les dossiers d'alerte sont vides jusqu'à 4.5 : le digest les annonce « en cours ».

## ADR-015 — Shell du cockpit : aperçus chargés à l'ouverture, heure de Paris en code

- **Date** : 2026-10-03
- **Statut** : acceptée
- **Contexte** : étape 3.1. Tout ID et tout chiffre doit ouvrir sa preuve (SPEC §12.1, P2), sans client Supabase dans le navigateur, et l'affichage doit rester en heure de Paris même présenté depuis un autre fuseau (CL-44).
- **Décision** :
  - **Aperçus des ID** (`EvidenceChip`, `InsightChip`, `BacklogItemChip`) : composants client qui appellent, à la première ouverture du popover, des server functions en lecture seule (`src/server/actions/evidence.ts` → `src/server/queries/evidence.ts`, service role). L'ID est validé par expression régulière avant toute requête. Une liste de 50 puces ne coûte donc rien tant qu'on n'en ouvre pas une ; résultat mis en mémoire dans le composant, nouvelle tentative après une erreur.
  - **`MetricWithSource`** reçoit des valeurs déjà calculées et formatées côté serveur (`lib/scoring`) : aucun calcul côté client.
  - **Dates** : `src/lib/format.ts` impose `timeZone: "Europe/Paris"` à tous les formats ; les dates relatives comptent les jours calendaires à Paris et reçoivent `now` en paramètre (`getDemoNow()` côté serveur, transmis au client), pour suivre l'horloge du scénario et éviter tout écart d'hydratation.
  - **Shell** : layout racine = sidebar (client, section active), en-tête avec statut du dernier run et alertes ouvertes (Server Component sous `Suspense`, `connection()` pour un rendu à la requête, erreurs absorbées en « indisponible »), panneau de chat repliable (vide jusqu'à 4.2). `error.tsx` (Next 16 : `retry`), `loading.tsx`, `not-found.tsx` communs.
  - **Design** : Inter (`next/font/google`, remplace Geist du scaffolding 0.1, Geist Mono gardé pour les ID), palette neutre, accent vert `--signal` ; texte courant à 14 px minimum, badges à 13 px ; largeur minimale 1 024 px pour tenir à 1 280 px zoomé à 110 % (~1 164 px utiles).
- **Conséquences** :
  - Les badges (`ChannelBadge`, `PlanBadge`, `HealthBadge`, `ModelBadge`, `BacklogKindBadge`) sont de simples `span` sans hook : utilisables depuis un Server Component.
  - Les liens des aperçus pointent vers `/retours?retour=R-xxx`, `/insights/I-xx` et `/backlog?element=US-xxx`, à honorer en 3.3, 3.4 et 4.3.
  - En local, `SITE_PASSWORD` active la Basic Auth : la configuration `signal-dev-noauth` de `.claude/launch.json` lance un serveur sans mot de passe sur le port 3001 pour les vérifications.

## ADR-016 — Écran Digest : structure tirée des faits, recommandations en titre + justification

- **Date** : 2026-10-03
- **Statut** : acceptée
- **Contexte** : étape 3.2. L'écran d'accueil doit se lire en 30 secondes (SPEC §12.2) : sections dans l'ordre fixe, ID cliquables, sparklines, comptes à risque avec MRR, décisions en attente avec un lien vers l'endroit où les traiter, recommandations en cartes (titre, justification, preuves). Le schéma de 2.7 ne donnait qu'une ligne `action` par recommandation.
- **Décision** :
  - **Sections 1 à 6 rendues depuis les faits** (`digests.content.facts`, calculés en code), pas depuis la prose du modèle : chaque chiffre est un `MetricWithSource` ou porte ses ID. La prose de Signal reste lisible en entier dans « Texte rédigé par Signal » (repliée) ; la voix de Signal porte sur les recommandations.
  - **Recommandations** : `titre` (≤ 90 caractères) + `justification` + `preuves` + `confiance` remplacent `action` ; la validation (ID connus, pas de chiffre sans ID, pas de date absolue) couvre titre et justification. Les digests antérieurs restent lisibles (`readDigestContent` : `action` → titre). Le modèle rédacteur est enregistré dans `content.model` (badge).
  - **Alertes** : le dernier digest affiche les alertes ouvertes maintenant, avec le dossier rédigé depuis (§10.10) ; un ancien digest affiche celles qu'il voyait.
  - **Sparklines** : `insights.trend.weekly` (6 semaines, calculé par le pipeline), sans nouveau calcul.
  - **Premier run (CL-18)** : pas de section « Mouvements », mention « Pas encore d'historique » ; « dont N confirment un sujet connu » masqué.
  - **Fusions et scissions (CL-15)** : `pendingDecisions()` (pur, testé) produit chaque décision en attente avec son lien (`/insights?statut=propose`, `/backlog?statut=brouillon`, `/backlog?conflits=notion`, `/insights/<absorbant>`, `/priorisation?insight=…`).
  - **`last_seen_at`** mis à jour à chaque visite de l'écran, via `after()` (après l'envoi de la réponse).
  - **« Régénérer »** : server action avec confirmation, sous le verrou du pipeline, identique à `pnpm digest` (pas d'incrémental) ; `maxDuration = 60` sur la page.
- **Conséquences** :
  - Un digest régénéré couvre la période depuis le digest précédent : sans nouveau retour, ses sections « nouveaux retours » et « mouvements » sont vides, les sections d'état (alertes, tendances, comptes) restent pleines.
  - Les liens vers Insights, Backlog et Priorisation sont à honorer en 3.4, 3.5 et 4.3.

## ADR-017 — Écran Retours : vue `feedback_inbox`, « pourquoi ce classement » composé en code

- **Date** : 2026-10-03
- **Statut** : acceptée
- **Contexte** : étape 3.3. Le tableau des retours doit être paginé côté serveur et filtrable par canal, plan, segment, type, domaine, insight, période, injection, fonctionnalité existante et échec d'analyse (SPEC §12.3). Ces critères vivent dans cinq tables (`feedbacks`, `customers`, `feedback_analyses`, `feedback_items`, `insight_items`) ; PostgREST ne sait pas filtrer une table sur un agrégat d'une autre. Le panneau de détail doit dire « pourquoi ce classement », alors que le triage ne stocke aucune justification libre.
- **Décision** :
  - **Migration 0005 : vue `feedback_inbox`** (une ligne par retour, `security_invoker`, révoquée pour anon et authenticated) : dernière analyse, tableaux `item_types`, `product_areas`, `insight_ids` (insights `propose` ou `actif` seulement : un insight fusionné garde des items figés, ADR-010), `existing_feature`, résumé du premier item et `search_text` (ID, objet, verbatim, résumés). Filtres PostgREST (`eq`, `cs`, `gte`, `ilike` échappé), `range` et `count: exact`. Testée sur PGlite.
  - **Filtres dans l'URL** (`canal`, `plan` dont `sans_compte`, `segment`, `type`, `domaine`, `insight`, `periode` 7 ou 30 jours relatifs à `DEMO_NOW`, `injection`, `existante`, `echec`, `q`, `page`) ; analyse pure et tolérante (`lib/feedbacks/filters.ts`) : une valeur inconnue est ignorée. 25 retours par page ; une page au-delà de la fin renvoie à la première.
  - **Panneau de détail** piloté par `?retour=R-042` (le lien des EvidenceChip de 3.1) : verbatim en texte, compte ou « compte non identifié », analyse (modèle, sentiment, urgence, langue, confiance, signaux, erreur en cas d'échec), puis chaque item avec ses insights (y compris un insight rejeté, signalé comme tel) et « pourquoi ce classement ».
  - **« Pourquoi ce classement »** composé en code (`lib/feedbacks/why.ts`) à partir des champs stockés : type et domaine, demande exprimée face au problème sous-jacent (P3), fonctionnalité existante (CL-05), type jamais regroupé, similarité au rattachement face au seuil de `weighting.yaml`, file « à surveiller » ou item isolé. Pas d'appel de modèle : une justification demandée après coup serait inventée.
  - **« Ajouter un retour »** : modale client → `POST /api/pipeline/incremental` (route de 2.6, inchangée) ; `source_type` déduit du canal (`CHANNEL_SOURCE_TYPES`, même table que `data/scenario.yaml`). 409 → « run en cours, réessaie » (rien n'est enregistré) ; échec du triage affiché sur le retour (CL-11).
- **Conséquences** :
  - Toute nouvelle colonne utile au tableau passe par une nouvelle vue ou une migration qui la recrée (`create or replace view` dans une nouvelle migration).
  - Le tableau compte les insights ouverts ; le détail montre aussi les insights rejetés qui ont absorbé l'item.

## ADR-018 — Revue des insights proposés : un service partagé, re-classement en code

- **Date** : 2026-10-03
- **Statut** : acceptée
- **Contexte** : étape 3.4. Le PO accepte, reformule, fusionne ou rejette les insights que Signal propose (SPEC §8.10, CL-51, CL-52), depuis l'écran Insights et, en 4.4, depuis le chat (`apply_decision`). Rejeter ou fusionner change le classement, qui doit bouger tout de suite (SPEC §8.5) sans rejuger tous les insights.
- **Décision** :
  - **Contrat** (`src/lib/insights/review.ts`, zod seul, importable côté client) : `accepter` (lot de 1 à 100 ID), `reformuler` (titre ≤ 140, énoncé ≤ 800), `fusionner` (`into`), `rejeter` ; raison facultative partout. Noms d'action en français, repris tels quels par l'agent.
  - **Service** (`src/services/insight-review.ts`) : règles de statut (accepter : `propose` seulement ; reformuler, fusionner, rejeter : `propose` ou `actif` ; fusion entre insights issus des retours uniquement, jamais vers un insight rejeté, fusionné ou archivé), une ligne `decisions` par insight (`validation`, `modification` avec champ `formulation` ou `merged_into` et avant/après, `rejet`), acteur `po`, source `signal_ui` ou `chat`. Refus métier → `InsightReviewError`, message affiché tel quel.
  - **Reformuler** : titre et énoncé remplacés, `title_locked`, statut `actif`. Le run complet ne réécrit plus la formulation (déjà respecté par `writeClustering`). Le nouvel énoncé change `problem_hash` : la prochaine estimation repart du modèle.
  - **Fusionner** : les items rejoignent la cible (`similarity` nulle, non représentatifs) ; l'insight fusionné garde ses items figés (`fusionne`, `merged_into`), ce qui permet au run suivant de rejouer la fusion (ADR-010, vérifié en test). Agrégats de la cible recalculés en code ; son libellé et ses demandes exprimées attendent le prochain run complet (items changés → réétiquetage).
  - **Rejeter / fusionner un insight classé** : son score courant est archivé (`is_current = false`, l'historique reste), puis tous les classés sont recalculés avec leur jugement stocké (`runScoring` en mode incrémental : aucun appel au modèle sauf pour un insight sans jugement valide ; seules les versions qui changent sont écrites). Accepter ou reformuler ne touche pas au classement (proposés et actifs sont classés pareil).
  - **Verrou** : l'action serveur passe par `withPipelineLock`, pour qu'un run concurrent n'écrase pas un statut avec son plan lu avant.
  - **Écran** : section « À valider » (toutes les propositions, cochées ; « Tout accepter » envoie les cochées en un lot ; actions par ligne), cartes des classés, signaux faibles, file « à surveiller » (items `watch` qui ne sont dans aucun insight vivant), filtre des rejetés. Tri et filtres dans l'URL (`tri`, `domaine`, `alignement`, `statut` = `propose` | `rejete`), analysés en code pur (`src/lib/insights/list.ts`). Page `/insights/[id]` : demandes exprimées (fréquence, preuves) face au problème, répartition, comptes (rattachement par `computeSignals`, comme le pipeline), canaux, tendance, tensions avec les insights vivants, retours représentatifs puis les autres, score décomposé (`MetricWithSource`, valeurs d'origine des overrides) et lien vers Priorisation.
- **Conséquences** :
  - Mesuré sur la base réelle : 24 acceptations en 3,4 s ; rejet de I-35 (rang 9) en 7,2 s, 0 € (aucun jugement refait), I-32 et I-41 remontent d'un rang. Base remise dans son état initial après le test (décisions D-001 à D-025 supprimées ; la séquence ne réutilise pas ces ID).
  - Les retours d'un insight rejeté restent rattachés à lui : hors classement, absents des compteurs de l'écran Retours (qui ne compte que `propose` et `actif`), visibles dans le détail d'un retour (« insight rejeté par le PO »). Un nouveau retour proche y est rattaché par l'incrémental et reste donc hors classement (ADR-013).

## ADR-019 — Priorisation interactive : classement recalculé en code, overrides liés au mode, sujet manuel

- **Date** : 2026-10-03
- **Statut** : acceptée
- **Contexte** : étape 3.5. Le PO bascule le Reach (comptes / MRR), écrase un paramètre, choisit le MoSCoW final et ajoute un sujet hors retours (SPEC §8.5, §8.9, §12.5, CL-21 à CL-25), et voit le classement bouger tout de suite, sans formule côté client ni appel de modèle (ADR-012 : « l'écran Priorisation devra recalculer en code à partir des jugements stockés »).
- **Décision** :
  - **Classement à la volée** : `computeStoredRanking` (`pipeline/nodes/score.ts`) recalcule tous les insights classés dans le mode demandé, avec les jugements stockés (`scores.judgment`) et les estimations en cache (`loadCachedInsightEstimates`, lecture seule, clé `problem_hash`) : aucun appel de modèle. Un insight sans jugement ou sans estimation valide est listé « en attente de score ». La bascule de l'URL (`?reach=mrr`) est une vue : les scores persistés restent dans le mode du pipeline (`currentReachMode`).
  - **Écritures** (`services/prioritization.ts`, réutilisable par l'agent en 4.4) : override, annulation, MoSCoW final et sujet manuel passent par `validateOverride` (lib/scoring), sous le verrou du pipeline, avec une ligne `decisions` chacun (avant / après / raison) ; puis les versions de score du mode du pipeline sont réécrites pour l'insight touché et ceux dont le résultat change (`sameResult`). Refus métier → `PrioritizationError`, message affiché tel quel. Confidence saisie en pourcentage (80) et stockée en ratio (0,8) ; 70 % est refusé.
  - **Override de Reach lié à son mode** : les deux modes n'ont pas la même unité et l'index unique n'autorise qu'un override actif par paramètre ; la valeur stockée est `{ mode, value }` et ne s'applique que dans ce mode (`overrideValues(overrides, mode)`). Un nombre seul reste accepté (tous modes).
  - **Sujet manuel** : insight `manuel`, `actif`, classé ; Reach `{ comptes, mrr }` (MRR nul → « non renseigné », Reach 0 en mode MRR), Impact, Confidence et éventuellement Effort sont des overrides avec la raison saisie ; un appel de jugement (alignement, MoSCoW recommandé) ; estimation seulement si aucun effort n'est saisi (`effortFromManual`, `manualEffortWeeks` : `runScoring` ne l'estime plus dans ce cas). Ses valeurs se modifient, elles ne s'annulent pas (sauf le MoSCoW).
  - **Écran** : tableau en grille animé par framer-motion 14 (`layout="position"`, désactivé si mouvement réduit ; le paquet se présente désormais comme « Motion », l'import `framer-motion` reste valide) ; popovers R / I / C / E (source calculé / estimé / écrasé / saisi, valeur d'origine, décomposition, justification, preuves, formulaire) ; alignement et tendance sous le titre pour tenir à 1 280 px chat ouvert ; jauge de capacité des Must finaux ; « Recommandations de Signal » dérivées en code (`lib/prioritization/recommendations.ts`) ; journal des décisions en tiroir filtrable (`lib/prioritization/journal.ts`) ; `?insight=I-xx` met la ligne en avant.
- **Conséquences** :
  - Mesuré sur la base réelle : classement recalculé en 0,6 à 1,5 s, identique aux rangs stockés en mode comptes ; un override re-classe en ~8 s (verrou, deux calculs, écritures séquentielles, re-rendu) ; sujet manuel avec jugement ~10 s. Base remise dans son état initial après les essais (D-051 à D-057 et I-51 supprimés ; les séquences ne réutilisent pas ces ID).
  - À 110 % de zoom chat ouvert, le tableau défile horizontalement dans son cadre (pas la page).

## ADR-020 — Écran Contexte : le pack lu tel quel, rendu markdown sans HTML

- **Date** : 2026-10-03
- **Statut** : acceptée
- **Contexte** : étape 3.6. Montrer ce que Signal sait de Jalon et où cela se modifie (SPEC §6.4, §12.8), sans dupliquer le contenu du pack.
- **Décision** :
  - `/contexte` lit les fichiers du repo à chaque requête (`server/queries/context.ts`) : les 7 documents de `CONTEXT_DOCUMENTS`, `weighting.yaml`, les skills par `listSkills` / `loadSkill`. Lecture seule, aucune action.
  - Rendu markdown par `react-markdown` 10 + `remark-gfm` 4 (tableaux), HTML brut désactivé (comportement par défaut), styles par composants (pas de plugin typography).
  - `weighting.yaml` en tableau (`lib/context-view.ts`, testé) : une section par clé de premier niveau avec son commentaire, une ligne par clé de second niveau, valeur sur une ligne, commentaire en ligne ou au-dessus d'une collection conservé. Les clés restent celles du fichier : c'est là qu'on les modifie.
  - L'encadré « Adapter Signal à un autre produit » est la section du même nom de `context/jalon/README.md` : une seule source pour les 3 étapes.
- **Conséquences** : modifier un fichier du pack se voit au rechargement de la page. `prototype-kit/` n'existe pas encore (étape du prototype) et n'est pas affiché.

## ADR-021 — Agent Signal : createAgent, briefing hors cache, budget d'outils en état, recherche pgvector

- **Date** : 2026-10-04
- **Statut** : acceptée
- **Contexte** : étape 4.1. Un agent unique avec ses outils de lecture, son briefing, sa mémoire et ses garde-fous (SPEC §6.2, §10). API vérifiée dans les sources installées : `langchain` 1.5.15 (`createAgent`, `createMiddleware`, `summarizationMiddleware`, `humanInTheLoopMiddleware`), `@langchain/langgraph-checkpoint-postgres` 1.0.5.
- **Décision** :
  - **Prompt** : persona, règles, principes P1 à P7, index des skills et 4 documents du pack (product, strategy, commitments, team) en blocs stables, point de cache sur le dernier (TTL 1 h : une conversation de PO a des pauses de plus de 5 min). Le **briefing** (code pur, `agent/briefing.ts`, faits de `services/briefing.ts` qui réutilise `loadDigestFacts` avec `since` = dernière visite et un top 10) est ajouté après ces blocs à chaque appel par un middleware `wrapModelCall`, encapsulé comme donnée avec la date du scénario.
  - **Outils** : un fichier par outil, contrat commun `signalTool` (zod, description « Quand l'utiliser / Pas quand », sortie JSON compacte bornée à 10 éléments, `wrapExternal`, erreurs courtes). Seul `load_skill` n'est pas encapsulé : une skill est une consigne interne versionnée, pas une donnée tierce. `readTools` (9 outils) sert aussi aux futures enquêtes ; `chatTools` y ajoute `add_feedback` (pipeline incrémental sous verrou).
  - **« Et si »** : `simulateRanking` (services/prioritization) recalcule le classement en mémoire avec des overrides hypothétiques validés par lib/scoring (`computeStoredRanking` reçoit un `adjust`). Rien n'est écrit.
  - **Recherche par le sens** : migration 0006, fonction `match_feedback_items` (pgvector, meilleur item par retour, seuil 0,35, 50 candidats), puis filtres sur la vue `feedback_inbox`.
  - **Budget de 15 appels d'outils par tour** : middleware maison plutôt que `toolCallLimitMiddleware` (message anglais, et un tour entièrement bloqué s'y termine sans réponse). Le compteur vit dans l'état de l'agent (remis à zéro en `beforeAgent`) : le middleware de résumé peut réécrire les messages au milieu d'un long tour. Au-delà : résultats d'erreur pour les appels en trop, retour au modèle qui répond « Réponse partielle : … » ; s'il insiste, réponse partielle fixe et fin du tour.
  - **Mémoire** : `PostgresSaver` (schéma `langgraph`, pool de 2 connexions, `DATABASE_URL` en pooler session) ; `threads` créé au premier message, `last_message_at` ensuite. Résumé au-delà de 30 messages, 12 gardés, prompt en français qui conserve les ID et l'origine des chiffres. Emplacement HITL posé vide (`interruptOn: {}`), configuré en 4.4.
  - **Flux** : `runTurn` (trace Langfuse `chat-turn`, session = conversation) émet `token` (nœud `model_request` seulement, sans la réflexion), `tool_start` / `tool_end` (événements `custom` écrits par un middleware `wrapToolCall` : nom, arguments résumés, durée, modèles), `interrupt`, `done` (coût du tour, lien Langfuse). Coût : usage de chaque appel de l'agent + coûts rendus par les outils (estimation, incrémental). Route `POST /api/agent` en SSE, `maxDuration` 300.
  - Un middleware ne voit dans `runtime.context` que les champs de **son** `contextSchema` : le schéma du contexte de tour est déclaré sur chacun.
  - `src/server/queries` importe `server-only` : `pnpm chat` lance `tsx --conditions=react-server`, et Vitest remplace ce module par un module vide.
- **Conséquences** : le coût du résumé (rare) n'est pas compté dans le coût du tour, seulement dans Langfuse. Un `add_feedback` crée un run incrémental dont la trace est imbriquée dans celle du tour. `get_insight` et `query_customers` relisent tous les comptes (≈ 0,3 à 1 s par appel).
