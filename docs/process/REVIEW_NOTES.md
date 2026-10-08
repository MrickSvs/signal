# Revue de code et nettoyage avant évaluation

Session du 8 octobre 2026 (début 01:28 UTC), sur `claude/busy-bell-lsbozo`, commit de départ `4b82d8a`. Ce n'est pas une étape de PLAN. Il n'y a eu aucun appel LLM, aucune API payante et aucune écriture en base.

## 0. État de départ

| Vérification | Résultat |
| --- | --- |
| `pnpm install --frozen-lockfile` | OK (pnpm 12.8.1, Node 22.22.0) |
| `pnpm lint` | OK, 0 avertissement |
| `pnpm typecheck` | OK |
| `pnpm test` | 91 fichiers, **760 tests verts** (~20 s) |
| `pnpm test:coverage` | **100 %** (lignes, branches, fonctions) sur `lib/scoring`, `lib/clustering`, `match.ts` et `mappers.ts` (11 fichiers) |
| Tests **sans réseau** (`unshare -rn`, namespace réseau vide) | 760/760 verts : la règle 11 est vérifiée, pas seulement déclarée |
| Clone à froid sans aucune variable d'environnement | install, lint, typecheck et test OK |
| `pnpm build` sans secrets | **échec** : voir Q1 |

Dans l'ensemble, le code est propre : un seul `eslint-disable` (justifié), aucun `any` ni `@ts-ignore`, aucun TODO, aucun `console.log` de debug dans `src`. Les sorties LLM sont validées par zod et les tests reposent sur l'injection de dépendances plutôt que sur des mocks de modules. Les constats ci-dessous sont surtout de l'ordre du nettoyage et de la cohérence.

---

## 1. Qualité du code

Classement : 🔴 bloquant · 🟠 important · 🟡 mineur. Je n'ai trouvé aucun bloquant au sens « l'app ne marche pas ».

### Bugs probables

| # | Gravité | Où | Constat | Correction proposée |
| --- | --- | --- | --- | --- |
| Q1 | 🟠 | `src/app/page.tsx:21`, `src/app/evals/page.tsx:18` | Ces deux pages ne lisent ni `searchParams` ni API dynamique : Next tente de les **pré-rendre au build**. Sans secrets, `pnpm build` échoue (`SUPABASE_URL… doivent être définies`, puis `fetch failed` sur `/evals`). Sur Vercel, le build interroge la base de production. Elles ne deviennent dynamiques que par effet de bord, via le `connection()` du `HeaderStatus` du layout. Ce couplage est implicite et fragile. | `export const dynamic = "force-dynamic"` sur les deux pages, comme `evals/annotate/page.tsx:6`. Le build passe alors sans secrets. |
| Q2 | 🟠 | `src/agent/tools/add-feedback.ts:84` | `models: ["triage", "reasoning"]` : la trace en direct du chat affiche Haiku alors que le pipeline trie avec Sonnet depuis l'ADR-035 (`PIPELINE_TRIAGE_MODEL`). La trace est donc fausse. | Dériver le rôle de `TRIAGE_MODEL_ROLES[PIPELINE_TRIAGE_MODEL]` (sans doublon) et ajouter un test. |
| Q3 | 🟡 | `src/agent/tools/list-backlog.ts:61` | `statut_notion` vaut toujours `null` : la synchronisation retour du statut (bonus 5.2, SPEC §11.3) n'existe pas. | Garder le champ (contrat §10.5) et le signaler en 8.2, ou le retirer de la sortie. Je recommande de le garder. |
| Q4 | 🟡 | `.env.example:33`, `src/proxy.ts:16` | `MCP_TOKEN` et l'exclusion `api/mcp` du matcher sont des restes du MCP coupé (ADR-031) : ni route ni lecture de la variable. | Retirer les deux. |

### Code mort, exports et dépendances

- `knip` brut signale 136 exports inutilisés, mais ce sont presque tous des exports utilisés seulement dans leur propre fichier. Avec `ignoreExportsUsedInFile`, il reste **9 exports et 4 types** : des ré-exports shadcn de `ui/dialog`, `ui/popover` et `ui/sheet` (code généré, à garder), `APPROVAL_TOOLS` (`src/agent/approval.ts:21`), `MODELS` ré-exporté par `src/lib/llm/index.ts:35`, `NOTION_STATUSES` (`mappers.ts:20`), `ResumeRequest` et `ApplyDecisionArgs`. 🟡 Je n'y touche pas : le gain est nul.
- Les 4 « fichiers inutilisés » de knip sont des faux positifs : `scripts/demo-purge.ts`, `review-sample.ts` et `smoke-llm.ts` se lancent avec `pnpm tsx`, et `server-only-stub.ts` est un alias Vitest.
- `depcheck` ne remonte que des faux positifs (`shadcn` et `tw-animate-css` sont importés en CSS ; les paquets Tailwind passent par postcss).
- 🟡 `shadcn` (le CLI) est en `dependencies` alors que seul son CSS sert à l'exécution. Il amène l'unique vulnérabilité de `pnpm audit` (voir §4). On peut le passer en `devDependencies`.
- 🟡 `scripts/demo-purge.ts` (199 lignes, sans test) a servi une fois à préparer la base de démo (BUILD_LOG 8.1). Depuis, `demo:reset` restaure un snapshot sans les retours de test. On peut le supprimer, à toi de décider (voir S9).

### Duplications et abstractions

- 🟡 Le chargement « pack de contexte + skills `triage-taxonomy`, `rice-scoring`, `moscow` » se répète dans `api/pipeline/incremental/route.ts:29`, `api/cron/digest/route.ts:29`, `agent/runtime.ts:26`, `server/actions/digest.ts:27` et 3 scripts. `server/scoring-context.ts` existe déjà pour le sous-ensemble du scoring. Un `loadPipelineContext()` voisin supprimerait ~40 lignes. Gain modéré, je ne le fais pas sans ton accord.
- 🟡 `fetchAll` (pagination générique) vit dans `src/pipeline/insights.ts:71` mais sert aussi à `agent/tools/query-customers.ts`, `server/queries/insights.ts` et `services/insight-review.ts`. Sa place est dans `src/lib/db/`. Le déplacement est mécanique et sans risque, mais ce n'est pas prioritaire.
- Je n'ai trouvé aucune abstraction « pour plus tard ».

### Fonctions longues (≥ 200 lignes)

`ChatProvider` (`components/chat/chat-provider.tsx:117`, 364 lignes), `InsightPage` (`app/insights/[id]/page.tsx:109`, 362), `incrementalSteps` (`pipeline/incremental.ts:341`, 336), `loadDigestFacts` (`pipeline/nodes/digest.ts:189`, 269), `buildPipelineGraph` (`pipeline/graph.ts:127`, 255), `matchClusters` (`pipeline/nodes/match.ts:135`, 235, couverte à 100 %), `runClustering` (`pipeline/insights.ts:294`, 224), `draftBacklog` (`services/backlog.ts:597`, 208). `services/backlog.ts` compte 1 297 lignes et `pipeline/nodes/score.ts` 1 069. 🟡 Je ne recommande **pas** de refactor avant l'évaluation : le risque dépasse le gain, et ces fonctions sont des suites d'étapes nommées et commentées. Pour un évaluateur, la réponse est que ce sont des orchestrateurs : la logique testable a été extraite en fonctions pures (`lib/`).

### Nommage, typage, erreurs, journalisation

- Les identifiants sont en anglais et les sorties d'outils en français, ce qui est voulu (la sortie s'adresse au modèle qui parle à Léa). Les entrées d'outils mélangent les deux langues (`besoin`, `consignes` d'un côté, `reason`, `item_ids` de l'autre), mais c'est conforme au contrat SPEC §10.5. 🟡 À laisser.
- Un seul `eslint-disable`, justifié (`agent/tools/shared.ts:114`, liste d'outils de schémas différents). Aucun `any`, `@ts-ignore` ni `@ts-expect-error`.
- Aucun TODO ni FIXME. Aucun `console.log` dans `src` : les 27 `console.error` et `console.warn` journalisent de vrais échecs côté serveur.
- Les `.catch(() => null)` portent sur du parsing de corps de requête ou des appels best-effort (trace, aperçu), et le cas `null` est géré à chaque fois. Le seul `catch {}` (`push-backlog.ts:265`) est une compensation (mettre la page Notion à la corbeille après un échec d'écriture du lien) : acceptable.

### Frontière serveur/client

- Il n'y a pas de client Supabase dans le navigateur : `createClient` n'apparaît que dans `src/lib/db/create.ts`, que n'importent que `client.ts` (gardé par `server-only`) et `script-client.ts` (CLI).
- Les composants `"use client"` n'importent que des server actions (`"use server"`), des types, `Constants` (énumérations de la base) et `MODELS` (noms de modèles, sans secret). Aucune variable `NEXT_PUBLIC_*`.
- 🟡 Plusieurs modules serveur (`services/*`, `agent/*`, `pipeline/*`) n'ont pas `import "server-only"`. Ils ne sont importés que depuis du code serveur, et le build échouerait sinon au moment où ils touchent `getDb()`. À laisser.

---

## 2. L'agent

### Prompts système et skills

- Le prompt système (`src/agent/system-prompt.ts`) est court, structuré et cohérent : persona, ton, chiffres et preuves, données tierces, outils, challenge, hors sujet. Les règles métier restent dans les skills : les modules du pipeline (`score`, `triage`, `backlog`, `estimate`) ont des consignes de 5 à 8 lignes qui chargent la skill au lieu de la recopier, ce qui respecte la règle 8.
- Le prompt est mis en cache (blocs stables avec un TTL d'1 h). Le briefing volatil passe en message système **après** la question, et la stabilité du préfixe est testée (ADR-022).
- 🟠 **A1 · Consignes contradictoires sur `load_skill`.** Le prompt (`system-prompt.ts:41`) dit « … (MoSCoW, challenge, estimation, digest)… Pas pour la rédaction du backlog : ses outils chargent leurs skills ». La description de l'outil (`tools/load-skill.ts:11`) dit « Avant toute tâche couverte par une skill (**rédaction**, MoSCoW, challenge, **estimation**, digest) ». Or `estimate_complexity` charge déjà la skill `estimation` (`services/estimate.ts:66`), et `draft_backlog_items` charge `backlog-format` et `user-story`. Le modèle reçoit deux consignes opposées et peut faire un appel d'outil inutile. **Correction** : aligner `when` sur le prompt (challenge, MoSCoW, digest ; ni rédaction ni estimation). C'est un changement de prompt **non mesuré** (pas d'éval possible sans appel LLM) : il est à revalider avec `eval:guardrails --tools`. La SPEC §10.5 porte la même formulation (à reprendre en 8.2).

### Les outils (`src/agent/tools/`)

- **14 outils construits, pas 15.** `generate_prototype` attend l'étape 7.1, reportée (ADR-031). SPEC §10.5, CLAUDE.md et l'en-tête de `tools/index.ts` parlent de quinze outils. La liste de 8.2 en tient compte.
- Le contrat commun est bien tenu (`shared.ts`) : entrée zod, description construite à partir du résumé et des champs « quand » et « pas quand », sortie JSON compacte encapsulée par `wrapExternal` (sauf `load_skill`, contenu de première main, justifié), listes bornées à 10 avec le total, 5 verbatims, erreurs courtes et actionnables (`unknownId` donne la plage d'ID valides).
- Chaque outil est conforme à SPEC §10.5. J'ai relevé deux extensions, compatibles : un filtre `status` sur `list_backlog`, et `confirm` sur les deux outils du backlog (le remplacement de brouillons et le changement de type exigent un oui explicite).
- Il n'y a pas de recouvrement réel : chaque description renvoie vers l'outil voisin dans son « pas quand ». Le seul point flou est A1.
- Aucun calcul n'est demandé au modèle (règle 2) : totaux et MRR sont calculés dans `selectCustomers`, le classement est recalculé en code dans `get_priority`, et l'estimation ne demande au modèle qu'une fourchette **brute** que le code corrige. Le prompt interdit explicitement d'additionner des valeurs lues dans un résultat.

### Validation zod des sorties LLM (règle 7)

Tout passe par `invokeStructured` (`lib/llm/structured.ts`) : sortie structurée native, `safeParse` zod, une nouvelle tentative guidée par les erreurs, puis `StructuredOutputError`. Le dossier d'enquête passe par un outil `submit_dossier` à schéma zod, et ses ID sont vérifiés en code (`verifyDossier`). Le digest refuse un ID absent des faits, une ligne chiffrée sans ID ou une date absolue. Côté chat, les ID cités sont vérifiés à l'affichage et les ID inconnus sont journalisés (`id_incidents`). ✅

### `wrapAsData` / `wrapExternal` (règle 3)

J'ai vérifié chaque appel LLM : `triage` (le retour passe par `wrapAsData`), `label-insights` (3 appels), `score`, `digest`, `estimate` (le besoin), `backlog` (insight, retours, consignes, élément), `judge`, et les résultats de tous les outils de l'agent. L'échappement des balises est testé (une balise fermante forgée est neutralisée). ✅

### Validation humaine (règle 5)

`apply_decision` et `push_to_notion` passent par `humanInTheLoopMiddleware` (`agent/approval.ts`). Une proposition invalide ne produit pas de carte et l'outil la refuse sans rien écrire (CL-23). Une modification sur la carte garde le type et la cible de la décision. Un refus est journalisé. Une carte laissée sans réponse reçoit un résultat synthétique pour que l'historique reste valide. L'enquête n'a que des outils de lecture (testé). ✅

### Appels LLM (règle 1)

Le seul point d'entrée est `src/lib/llm` (`getModel`, `invokeStructured`). La règle ESLint `no-restricted-imports` bloque `@anthropic-ai/sdk` et `@langchain/anthropic` dans `src` et `scripts`. Les tarifs de `models.ts` sont conformes à la grille actuelle (Opus 5.5 à 4 et 20 $, cache read 0,20 $ ; Sonnet 5.5 à 2 et 10 $, cache read 0,20 $ ; Haiku 4.5 à 1 et 5 $). ✅

### Conception des evals

Huit runners couvrent triage (avec le jeu réservé), cas limites E1 à E8, Haiku contre Sonnet, détection, estimation en leave-one-out, stabilité, garde-fous et choix d'outil, calibration du juge et backlog. Les métriques sont en code (`scripts/evals/lib/metrics.ts`, testé). Le juge Opus est calibré contre le PO (κ 0,71, 86 % à ≤ 1 point). La séparation entre jeu de développement et jeu réservé est gardée par ESLint (imports et littéraux de chemin) et par un test qui attrape aussi les chemins découpés.

- 🟠 **E1** · `docs/EVALS.md` affiche le triage mesuré **avec Haiku** (88,7 % ❌, F1 0,848 ❌) alors que le pipeline trie avec Sonnet (ADR-035). Un évaluateur lit « Triage ❌ » sans comprendre pourquoi. Il faut lancer `eval:triage --model sonnet` (coût à annoncer), ou au moins expliquer l'écart (8.2).
- 🟡 « Choix d'outil et enquête » et « Backlog » ne sont pas mesurés ; l'estimation porte sur 10 tickets sur 40 et la stabilité sur 1 run (dettes connues du BUILD_LOG).
- 🟡 TC-16 (`evals/tool-choice.json:159`) attend `generate_prototype` : il échouera tant que 7.1 n'est pas faite. C'est annoncé dans les notes du runner. À garder.

### Risque à vérifier à la main

🟡 Le résumé des conversations longues (`summarizationMiddleware`, au-delà de 30 messages) réécrit l'historique. Sur Sonnet 5.5, les blocs de réflexion sont liés à la conversation (« preserved thinking ») et certains comptes récents reçoivent un 400 si l'historique est modifié. Le test CL-30 est simulé. Il faut donc vérifier en local qu'une conversation de plus de 30 messages continue de répondre.

---

## 3. Tests

- 91 fichiers et 760 tests. Les noms décrivent des comportements (« refuses before touching the base », « never drops it silently »). Il n'y a aucun test de formulation d'une sortie de modèle : les fakes renvoient des structures.
- Il n'y a aucun appel réseau, et c'est prouvé : la suite passe dans un namespace réseau vide. L'isolation passe par l'injection (`invoke`, `embedQuery`, `notion`, `createMemoryDb`) plutôt que par `vi.mock` (2 occurrences seulement).
- La couverture à 100 % est tenue sur les 4 périmètres exigés. La CI lance `test:coverage`, donc le seuil y est bloquant.
- **Trous sur de la logique déterministe** (fonctions pures sans test direct) :
  - `compactInsight` (`agent/tools/get-insight.ts:27`, 120 lignes) : ce que l'agent voit d'un insight (bornes de verbatims, MoSCoW final, comptages) ;
  - `toFound` et le filtrage de `search_feedbacks` (`agent/tools/search-feedbacks.ts`) ;
  - la sortie de `list_backlog` (ID introuvables, note de liste vide) ;
  - `server/queries/evidence.ts` (aperçus au survol) et `scripts/evals/lib/record.ts` (écriture d'`EVALS.md`).

  Ce sont des ajouts de tests sans risque (S8).
- 🟡 `src/lib/db/memory.ts` et `src/pipeline/fake-world.ts` sont des doublures de test placées dans `src` sans suffixe `.test`. Elles ne sont pas importées par l'app, donc absentes du bundle. À garder.

---

## 4. Sécurité et hygiène

- **Secrets** : j'ai scanné tout l'historique avec gitleaks 8.24 (95 commits, après `git fetch --unshallow`), plus des recherches ciblées (`sk-ant-`, `pa-`, JWT, `ntn_`, `secret_`, `sk-lf-`, URL Postgres avec mot de passe). Il y a 3 détections, toutes des **faux positifs** (`"key": "cost_per_100_haiku"` dans un rapport d'éval). Aucun `.env` n'a jamais été commité. L'ID du projet Langfuse apparaît dans des liens de traces : ce n'est pas un secret (il faut être connecté). Les adresses e-mail des données sont fictives.
- **`.env.example`** : complet par rapport aux `process.env` du code. `ANTHROPIC_API_KEY` et `LANGFUSE_BASE_URL` sont lues implicitement par les SDK, et `NOTION_*` et `DEMO_NOW` passent par un objet `env`. Seule `MCP_TOKEN` est en trop (Q4).
- **`.gitignore`** : complet (`.env*` sauf l'exemple, `.cache/`, `coverage`, `.next`, `.vercel`, `*.tsbuildinfo`, `next-env.d.ts`). Aucun fichier généré n'est suivi.
- **`pnpm audit`** : 1 vulnérabilité haute, `braces ≤ 3.0.3` (GHSA-vfj7-8cjw-p6xm, déni de service sur des motifs imbriqués), atteinte seulement via `shadcn > @shadcn/registry > fast-glob > micromatch`, donc l'outil CLI. Il n'y a pas de correctif publié et le chemin n'est jamais emprunté à l'exécution. Rapport seulement, aucune montée de version.
- **`package.json`** : `name` (`signal`) et `private: true` sont présents. Il manque `description` et `engines`. Il n'y a ni `.nvmrc` ni `engines`, et la CI tourne sur `lts/*` (non figé) alors que le développement se fait sous Node 22. 🟡 Proposition S6 : `.nvmrc` à `22`, `engines.node >= 22`, CI sur `node-version-file`.
- **Poids** : 4,3 Mio compressés. Le plus gros fichier est `data/demo-snapshot/feedback_items.json` (3 Mo, les embeddings), nécessaire pour que `demo:reset` tourne sans Voyage. `evals/reports/` contient 12 rapports, dont 3 calibrations du juge qui retracent la montée de κ de 0,39 à 0,71 : c'est une preuve utile, à garder. Il n'y a ni cache ni sortie de debug commités.

---

## 5. Clone à froid et CI

- Un clone neuf dans un dossier temporaire, lancé avec `env -i` (aucune clé, aucune variable du projet), passe `pnpm install --frozen-lockfile && pnpm lint && pnpm typecheck && pnpm test` ✅.
- `pnpm build` sans secrets échoue (Q1). Avec Q1 corrigé, il doit passer : je le vérifierai en phase 2.
- La CI (`.github/workflows/ci.yml`) lance les mêmes commandes (`test:coverage` à la place de `test`, sans aucun secret) et publie le rapport de couverture en artefact. Elle est cohérente. Seule la version de Node n'est pas figée (S6).

---

## 6. Bruit pour l'évaluateur

- **Renvois aux étapes de PLAN dans le code** : **74 occurrences dans 59 fichiers** (« PLAN 2.3 », « in 4.4 », « Step 4.1 », « comes in 2.6 », « Before step 3.2 »…). Ils sont surtout dans les en-têtes des scripts CLI et dans `src/services`, `src/pipeline` et `src/agent`. → Je les retire, et je garde les renvois aux § de SPEC, aux ADR et aux CL-xx.
  - Certains commentaires disent une chose fausse aujourd'hui : `src/pipeline/nodes/alert.ts:5` (« comes in 4.5: until then… », alors que l'enquête existe), `src/pipeline/insights.ts:3` (« Graph wiring comes in 2.6 »), `src/agent/index.ts:91` (« and push_to_notion in 5.2 »). Je les réécris au présent.
  - `context/jalon/weighting.yaml:57,112,113,116` dit « réglé en 2.3 » ou « mesuré en 8.1 » : je remplace par la référence à l'ADR (ADR-011, ADR-010, ADR-034).
  - `scripts/evals/guardrails.ts:526` : la note « livré à l'étape 7.1 » se retrouve dans les rapports. Je la remplace par « pas encore construit (ADR-031) ».
- **Fichiers de processus à la racine** : `PLAN.md` (93 Ko) et `CHANGELOG.md` (45 Ko, figé à l'étape 6.1, « État actuel » faux). → Décisions déjà prises, voir §11.
- **`.claude/skills/langfuse/`** : skill tierce copiée dans le dépôt. → À supprimer (décision prise).
- Je n'ai trouvé aucun mot adressé à un examinateur ni à l'IA, aucune note de session dans le code, aucune sortie de debug.
- Les scripts ponctuels déjà joués sont `scripts/review-sample.ts` (relecture humaine, étape 1.4) et `scripts/demo-purge.ts`. Je recommande de **garder** `review-sample` (c'est une preuve de méthode, et CLAUDE.md le documente) et de supprimer `demo-purge` (S9, à toi de décider).

---

## 7. UI

`SITE_PASSWORD` n'est pas défini dans cet environnement : je n'ai donc pas navigué sur l'app déployée. Revue statique de `src/app` :

- Les états **globaux** existent (`app/loading.tsx`, `app/error.tsx`, `app/not-found.tsx`). Les états **vides** sont présents sur Digest, Retours, Insights, Priorisation, Backlog et le détail d'un insight (`EmptyState`). Le statut du pipeline a son squelette (`HeaderStatusSkeleton`) et `Promise.allSettled` gère son erreur.
- **ID cliquables (SPEC §12.1)** : dans le chat, tous les types d'ID deviennent des puces avec aperçu (`lib/chat/ids.ts`). Dans les écrans, 🟡 les **ID de comptes `C-xxx`** sont en texte simple (`components/digest/sections.tsx:528`, `components/feedbacks/feedback-detail.tsx:154`), faute de vue Compte. Les ID des décisions `D-xxx` du journal sont l'entité elle-même. À vérifier à l'œil.
- `/evals/annotate` renvoie un 404 en production, ce qui est voulu (outil local). La page `/evals` a besoin de la base au build (Q1).
- La largeur minimale de 1 024 px est fixée dans le layout (desktop d'abord, conforme à CLAUDE.md).

À vérifier en local : voir la checklist de fin de session.

---

## 8. Couverture de l'énoncé

| Attendu | Code | Tests | Comment le démontrer |
| --- | --- | --- | --- |
| **Traitement des retours** | `pipeline/nodes/triage.ts` (type, domaine, 1 à 3 items par sujet, injection), `enrich.ts` (rattachement au compte, signaux business), `incremental.ts`, outil `add_feedback` | `triage.test.ts`, `enrich.test.ts`, `incremental.test.ts`, `eval:triage` (jeu réservé), cas E1 à E8 | Écran Retours ; coller un retour de `data/demo/retours-a-coller.md` dans le chat |
| **Tendances** | `lib/insights/aggregates.ts` (croissance, émergent), `pipeline/nodes/alert.ts`, digest « Ce qui bouge » | `aggregates.test.ts`, `alert.test.ts`, `digest.test.ts` | Écran Digest ; sparkline des Insights ; « quoi de neuf ? » dans le chat |
| **Extraction de demandes** | `underlying_problem` contre demande exprimée (P3), `expressed_requests` par insight, regroupement par problème (`lib/clustering`, `match.ts`, `label-insights.ts`) | `agglomerative.test.ts` et `match.test.ts` (100 %), `label-insights.test.ts`, `eval:detection` | Détail d'un insight : problème, demandes exprimées et fréquences |
| **Scoring RICE** | `lib/scoring/*` : Reach et Confidence calculés, Impact jugé par le modèle et justifié, Effort par analogie ; robustesse | `scoring.test.ts` (100 %), `score.test.ts`, `eval:stability` | Priorisation : décomposition R I C E au clic ; `get_priority` avec `what_if` |
| **MoSCoW** | `lib/scoring/moscow-rules.ts` (règles dures), recommandation du modèle (skill `moscow`), `capacity.ts` (capacité des Must), override journalisé | `scoring.test.ts`, `prioritization.test.ts`, `apply-decision.test.ts` | Popover MoSCoW ; « passe I-xx en Must » dans le chat, puis challenge et carte d'approbation |
| **Justification** | `impact_rationale`, `moscow_rationale`, preuves = ID de retours vérifiés en code, skill `challenge`, journal `decisions` | `score.test.ts`, `approval.test.ts`, `eval:guardrails` | Score décomposé ; journal des décisions |
| **User stories** | `services/backlog.ts` (format choisi en code, skills `backlog-format` et `user-story`), `lib/backlog/*` | `backlog.test.ts`, `backlog-tools.test.ts`, `judge.test.ts` | « Prépare le backlog de I-xx » ; écran Backlog |
| **Critères d'acceptation** | Gherkin validé en code (`lib/backlog/draft.ts` : 2 à 5 scénarios, mots-clés) | `lib/backlog/backlog.test.ts` | Contenu déplié d'une story ; badge du juge |
| **Estimation de complexité** | `services/estimate.ts`, `lib/estimation/reference.ts` (analogues, correction de biais, Fibonacci, T-shirt), outil `estimate_complexity` | `reference.test.ts`, `estimate.test.ts`, `eval:estimation` (leave-one-out) | « Combien coûterait I-xx ? » ; `pnpm estimate I-07` |
| Livrable : code | Next.js, pipeline LangGraph, agent LangChain v1 | — | — |
| Livrable : démo | `demo:snapshot` et `demo:reset`, retours à coller | `scripts/lib/demo.test.ts` | **Trou** : pas de `docs/DEMO_SCRIPT.md` (prévu en 8.2) |
| Livrable : documentation | SPEC, ADR, ARCHITECTURE, EVALS | — | **Trou** : README minimal, ARCHITECTURE ne décrit que le pipeline (8.2) |
| Livrable : tests | 760 tests, couverture à 100 % sur le cœur, evals | CI | Badge CI ; `pnpm test:coverage` |

Trous identifiés : le script de démo, le README, l'ARCHITECTURE de l'agent (outils, HITL, enquêtes, evals), le triage mesuré sur le bon modèle (E1), le choix d'outil non mesuré, et le prototype (7.1, reporté, hors énoncé).

---

## 9. À reprendre en 8.2

1. **README.md** : il tient en une ligne de présentation plus la mise en place de Notion. Il annonce « Ce README sera complété à l'étape 8.2 » (phrase de processus). Il manque : quoi, pour qui, démarrage, architecture en 5 lignes, evals, limites.
2. **docs/ARCHITECTURE.md** : il ne couvre que le pipeline. Il manque l'agent (14 outils, middleware, HITL, enquêtes, mémoire), l'UI et les evals. Le tableau des nœuds dit « triage · Haiku » alors que c'est Sonnet (ADR-035). La phrase « il est complété au fil des étapes » est du processus.
3. **docs/EVALS.md** : triage mesuré sur Haiku au lieu de Sonnet (E1), commits marqués `-dirty`, « Choix d'outil » et « Backlog » non mesurés.
4. **Nombre d'outils** : « quinze » dans SPEC §10.5 et CLAUDE.md (Conventions), contre 14 construits. `generate_prototype` attend 7.1.
5. **MCP** : SPEC §10.9, la ligne `MCP_TOKEN` de SPEC §16 et SPEC §3 (« exposition MCP ») décrivent un bonus coupé (ADR-031).
6. **Retour du statut Notion** (SPEC §11.3, bonus 5.2) : non construit. `statut_notion` vaut toujours `null`.
7. **`context/jalon/prototype-kit/`** : cité dans CLAUDE.md (Stack) et `context/jalon/README.md:18`, mais **absent** (il prépare 7.1).
8. **SPEC §10.5 `load_skill`** : la formulation « rédaction… estimation » contredit le prompt (A1).
9. **SPEC §6.6** (arborescence) : `docs/` cite `DEMO_SCRIPT` (absent) et `BUILD_LOG` (déplacé). `docs/README.md` cite `DEMO_SCRIPT` (je n'y touche pas, décision prise).
10. **SPEC §5** : titre « Scénario maître _(à valider)_ ». La validation est faite, la mention est périmée.
11. **DECISIONS.md** : ADR-037 apparaît avant ADR-036 (ordre).
12. **Chiffres à recaler** : 214 retours ou 239 (avec les retours à coller), 25 ou 26 insights actifs, 760 tests, coût cumulé.
13. **PLAN 8.2, point 6** : `scripts/build-time.ts` doit lire `docs/process/BUILD_LOG.md` (nouveau chemin).
14. **`/status`** : citée dans CLAUDE.md (Pièges connus, Supabase gratuit) et dans SPEC CL-43, alors qu'elle a été coupée (ADR-031). CL-46 cite un « prototype pré-généré » qui n'existe pas.
15. **Registre des cas limites** : ajouter les cas de §12.3 (CL-59 et suivants) avec leur traitement ou « limite connue ».
16. **Procédure de démo** : reset et digest le matin même, après le passage du cron (F3) ; ne pas régénérer deux fois tant que F2 n'est pas corrigé.

---

## 10. Simplifications proposées (meilleur ratio clarté/effort)

| # | Changement | Effort | Risque |
| --- | --- | --- | --- |
| S1 | Retirer les 74 renvois aux étapes de PLAN des commentaires (garder §, ADR, CL), réécrire au présent les 3 commentaires faux, remplacer « réglé en 2.3 » par l'ADR dans `weighting.yaml` | moyen, mécanique | nul : commentaires seulement (lint, typecheck et tests le confirment) |
| S2 | Q1 : `dynamic = "force-dynamic"` sur `/` et `/evals`, ce qui donne un build sans secrets et sans lecture de la base au build | 2 lignes | faible : en production, ces pages sont vraisemblablement déjà rendues à chaque requête à cause du `connection()` du layout ; la ligne rend ce comportement explicite |
| S3 | Q2 : modèles affichés pour `add_feedback` dérivés de `PIPELINE_TRIAGE_MODEL`, plus un test | 5 lignes | nul |
| S4 | Q4 : retirer `MCP_TOKEN` de `.env.example` et `api/mcp` du matcher du proxy | 2 lignes | nul (aucune route MCP) |
| S5 | A1 : aligner `load_skill.when` sur le prompt système | 1 ligne | **moyen** : prompt modifié sans éval possible ; à revalider avec `eval:guardrails --tools` |
| S6 | `.nvmrc` (22), `engines.node >= 22`, `description` dans `package.json`, CI sur `node-version-file: .nvmrc` | 4 lignes | faible : la CI passe de `lts/*` à 22, la version de développement |
| S7 | `shadcn` en `devDependencies` (seul son CSS sert, au build) | 1 ligne + lockfile | faible : Vercel installe les devDependencies au build ; `pnpm audit --prod` devient propre |
| S8 | Tests de `compactInsight`, `toFound` et `list_backlog` (fonctions pures de l'agent) | moyen | nul (ajout) |
| S9 | Supprimer `scripts/demo-purge.ts` (ponctuel, remplacé par `demo:reset`) et sa ligne dans CLAUDE.md | faible | faible : on perd la purge ciblée sans snapshot |
| S10 | `loadPipelineContext()` à côté de `loadScoringContext()` ; `fetchAll` déplacé dans `lib/db` | moyen | faible, mais c'est du refactor : je ne le recommande pas avant l'évaluation |

Ma recommandation : S1 à S4, S6 et S8 sans hésiter. S5 et S9 selon ton avis. S7 est optionnel. S10 est à éviter maintenant.

---

## 11. Décisions déjà prises : application en phase 2

- **Déplacer** `PLAN.md` et `docs/BUILD_LOG.md` dans `docs/process/`, avec un `docs/process/README.md` de 3 lignes. Références à mettre à jour : `README.md:5` (liens), `CLAUDE.md:8,13,20,21,75`, `SPEC.md:4,305,319` (chemins seulement), `.prettierignore:5`, et dans `PLAN.md` les mentions de `docs/BUILD_LOG.md`.
- **Supprimer `CHANGELOG.md`.** Ce qu'il contient et qui manque à BUILD_LOG et aux ADR, à reporter dans BUILD_LOG avant la suppression :
  - les variables Vercel ne sont définies qu'en **Production** (ni Preview, ni Development) ;
  - « heure du seed » : un retour « du jour » est placé avant l'instant du seed, donc seeder en journée avant une démo. C'est peut-être périmé depuis les deux décalages de `demo:reset` (ADR-032), à vérifier ;
  - redémarrer `pnpm dev` après une modification de l'agent (prompt, outils), car l'agent est gardé dans `globalThis` ;
  - un test instable corrigé (`8001d0f`, ordre des erreurs de `loadContextPack`).

  Le reste figure déjà dans BUILD_LOG ou dans les ADR (renvois « → ADR-xxx »). Le lien du README vers le CHANGELOG est remplacé par BUILD_LOG.
- **Supprimer `.claude/skills/langfuse/`.** Aucune référence dans le code. La mention dans BUILD_LOG (0.3) est historique : à garder.
- **Garder** SPEC, DECISIONS, ARCHITECTURE, EVALS, CLAUDE.md (structure et commandes mises à jour) et AGENTS.md. **Ne pas toucher** `docs/README.md`.
- Aucune objection de ma part.

---

## 12. Repasse fonctionnelle (back et front)

Relecture des parcours de bout en bout : pipeline, scoring, revue des insights, priorisation, backlog, Notion, digest, alertes, chat et écrans. Je cherchais les cas limites, les incohérences entre écrans et les fonctionnalités à simplifier. Tout est en lecture seule, sauf un test de reproduction temporaire (non commité) pour F1.

### 12.1 Bugs fonctionnels

| # | Gravité | Scénario | Ce qui se passe | Où | Correction proposée |
| --- | --- | --- | --- | --- | --- |
| F1 | 🟠 | Léa **reformule** un insight classé (écran Insights ou chat) | L'insight **sort du classement**. Priorisation l'affiche sous « En attente de score (prochain run) : I-xx (estimation manquant) ». Sa capacité Must et ses recommandations disparaissent, alors que la fiche insight garde l'ancien rang stocké. La cause : le cache d'estimation est indexé sur l'empreinte de l'énoncé, que la reformulation change sans relancer d'estimation. **Reproduit** par un test temporaire sur la base en mémoire : I-01 est classé avant, absent après. La base de démo actuelle n'est pas touchée (ses 9 insights classés ont leur estimation). | `services/insight-review.ts:311`, `services/estimate.ts:460`, `pipeline/nodes/score.ts:997` | Sur le chemin de lecture (`loadCachedInsightEstimates`), retomber sur la dernière estimation de l'insight quand l'empreinte diffère, en la marquant « énoncé modifié » ; le run suivant réestime. Aucun appel de modèle, et un test à ajouter. Autre option : réestimer dans la reformulation (un appel, 5 à 10 s). |
| F2 | 🟠 | Léa clique **deux fois sur « Régénérer »** dans le Digest | Le second digest couvre « depuis le digest précédent », c'est-à-dire quelques secondes. Tendances, mouvements de rang, nouveaux retours et recommandations disparaissent, et l'écran ne montre que le dernier digest. Le texte du bouton (« relit les faits tels qu'ils sont maintenant ») laisse croire à un simple rafraîchissement. | `pipeline/nodes/digest.ts:46`, `server/actions/digest.ts:23`, `components/digest/regenerate-button.tsx` | « Régénérer » réécrit le digest affiché **sur la même période** (même début) au lieu d'en ouvrir une nouvelle. Alternative minimale : afficher la période (« depuis le … ») et prévenir dans la confirmation. |
| F3 | 🟠 | **Cron quotidien à 04:00 UTC** en production, après un `demo:reset` + `pnpm digest` la veille | Le cron génère un nouveau digest sur la nuit (presque vide) : même effet que F2 le jour de la démo. | `vercel.json`, `app/api/cron/digest/route.ts` | Faire le reset et le digest **le matin de la démo, après 6 h (heure de Paris)**, ou couper le cron ce jour-là. La correction de F2 ne règle pas F3 : c'est une question de procédure. |
| F4 | 🟡 | Un retour collé ressemble à un **insight rejeté** | Il est absorbé par l'insight rejeté (CL-53, voulu), mais le résultat annonce « confirme un sujet connu : I-xx », sans dire que le sujet est rejeté. Aucune alerte n'est levée (`alert.ts:92`). Léa croit le retour compté alors qu'il sort du classement. | `pipeline/incremental.ts:119`, `:224` | Ajouter le statut dans la phrase (« rejoint I-xx, **rejeté** : hors classement »). Décision produit à prendre : signaler un sujet rejeté qui revient avec N nouveaux retours. |
| F5 | 🟡 | Override de **Reach en mode comptes**, puis bascule en **mode MRR** | La cellule affiche la valeur calculée (correct : l'override ne vaut que dans son mode), mais le popover montre « Ta raison… », « Modifier l'override » et « Annuler l'override ». Ce bouton annule l'override du mode comptes depuis l'autre mode. | `server/queries/prioritization.ts:209` | Ne transmettre l'override de Reach que si son mode est celui affiché (lire `value` dans la requête des overrides). |
| F6 | 🟡 | Clic sur **« Faire l'action proposée »** d'une alerte | L'alerte passe « traitée » et une décision `validation / action_proposee` est journalisée **avant** que le chat exécute l'action. Si Léa refuse ensuite la carte d'approbation, ou si la rédaction échoue, l'alerte reste close et le journal dit « validée ». | `components/alerts/alert-card.tsx:61`, `services/alerts.ts:61` | Journaliser « action lancée » (champ `action_lancee`) plutôt qu'une validation, ou ne clore l'alerte qu'au succès de l'outil. |
| F7 | 🟡 | Léa **rejette ou fusionne un insight qui a un backlog** | Ses brouillons et éléments validés restent dans l'écran Backlog, sans mention du statut de l'insight, et peuvent toujours être envoyés dans Notion. La rédaction, elle, est refusée sur cet insight. | `server/queries/backlog.ts:115`, `services/insight-review.ts` | Afficher le statut de l'insight dans l'en-tête du groupe. Refuser l'envoi d'un élément dont l'insight n'est plus vivant, ou prévenir au rejet (« I-xx a N brouillons »). |
| F8 | 🟡 | Rejet d'un élément du backlog (chat) | L'effort de l'insight (somme des points) change, mais le score stocké n'est pas recalculé. Priorisation (calculée en direct) et fiche insight (score stocké) divergent jusqu'à la prochaine écriture. | `services/backlog.ts:1036` | Appeler `refineEffort` après un rejet, comme après une modification de points. |
| F9 | 🟡 | Jugement d'un insight en échec pendant un run | Son ancien score reste « courant » à côté des nouveaux rangs, ce qui peut produire deux insights au même rang dans `scores`. C'est une dette connue (2.5). L'écran Priorisation (calcul en direct) n'est pas touché. | `pipeline/nodes/score.ts`, `runScoring` | Archiver le score périmé, ou le marquer « en attente ». |
| F10 | 🟡 | Libellé dans Priorisation | « (estimation manquant) » | `app/priorisation/page.tsx:103` | « manquante » pour l'estimation, « manquant » pour le jugement. |
| F11 | 🟡 | `DEMO_NOW` défini (pas le cas en production, ADR-032) | `markSeen`, `touchThread` et les `updated_at` prennent l'heure réelle, alors que le scénario suit `getDemoNow()`. Le calcul de la période du digest mélange alors deux horloges. | `app/page.tsx:25` | `markSeen(db, getDemoNow())`. |

### 12.2 Écarts avec la SPEC (fonctionnalités)

| # | Écart | Effet | Proposition |
| --- | --- | --- | --- |
| G1 | `apply_decision` ne sait ni **créer un sujet manuel** (listé dans SPEC §10.5), ni **annuler un override** | Dans le chat, « reviens à la recommandation » se traduit par un override égal à la recommandation, qui reste actif, et « ajoute un sujet hors retours » est impossible. | Ajouter `cancel_override` (le service `cancelOverride` existe) ; pour le sujet manuel, corriger la SPEC (8.2) plutôt qu'ajouter un type. |
| G2 | Écran Backlog : ni **« Rejeter »** ni **« Valider »** sans envoi (seulement « Valider et envoyer ») | Sans Notion configuré (évaluateur en local), on ne peut valider un brouillon que par le chat : « Valider et envoyer » valide, échoue à l'envoi, puis tourne sur « Réessayer ». Un mauvais brouillon ne se rejette que par le chat. | Deux boutons sur `reviewBacklogItem`, qui existe déjà et est journalisé. |
| G3 | « Synchroniser Notion » (§11.3) et « Visualiser » (§13) absents | Connu : bonus 5.2 non fait, 7.1 reportée. | Liste 8.2. |
| G4 | Recherche de l'écran Retours **lexicale** (`ilike`), alors que l'agent a la recherche par le sens | « retards de notification » ne trouve pas « je ne reçois rien ». | En option : réutiliser `match_feedback_items` (un appel Voyage par recherche). |
| G5 | « Ajouter un retour » n'a pas de champ **e-mail de l'auteur** | Le rattachement par domaine e-mail, principal chemin du nœud `enrich`, est impossible depuis l'écran : seul le choix manuel du compte fonctionne (c'est ce que fait la démo). | Champ facultatif « E-mail de l'auteur ». |

### 12.3 Cas limites hors registre (à ajouter en CL-59 et suivants)

- Reformulation d'un insight classé (F1).
- Digest régénéré deux fois, ou cron passé avant la démo (F2, F3).
- Retour qui rejoint un insight rejeté (F4).
- Insight rejeté ou fusionné qui a un backlog (F7).
- Notion non configuré : validation impossible depuis l'écran (G2).
- **Rédaction concurrente** du même insight (chat et écran en même temps) : `draftBacklog` lit puis insère hors verrou, donc deux backlogs peuvent coexister. Probabilité faible ; le verrou du pipeline suffirait.
- Alerte **ignorée** puis nouveau retour du même compte dans les 24 h : une nouvelle alerte et une nouvelle enquête (≈ 0,03 €) sont créées, car seules les alertes ouvertes s'enrichissent (`alert.ts:182`). Comportement à assumer ou à corriger.

### 12.4 Améliorations et simplifications fonctionnelles

| # | Proposition | Gain | Risque |
| --- | --- | --- | --- |
| S11 | F1 : repli sur la dernière estimation de l'insight, plus un test | le bug le plus visible en démo disparaît | faible (lecture seule, le run suivant réestime) |
| S12 | F2 : « Régénérer » réécrit la même période | le Digest ne se vide plus | faible : la fonction `digestPeriod` est pure et testée |
| S13 | G2 : boutons « Valider » et « Rejeter » dans l'écran Backlog | démo sans Notion possible, chat moins indispensable | faible (service existant et testé) |
| S14 | F4, F5, F10 : phrase « rejeté », override de Reach limité à son mode, accord « manquante » | moins de confusion à l'écran | nul |
| S15 | Impact et Confidence saisis par **boutons** (3 · 2 · 1 · 0,5 · 0,25 et 100 · 80 · 50 %) au lieu d'un champ texte libre | supprime un chemin d'erreur ; la validation serveur (CL-23) reste | nul |
| S16 | Recommandation « écart » (choix du PO ≠ recommandation) affichée **seulement** quand la recommandation vient d'une règle dure (engagement, churn, bug critique) | aujourd'hui, chaque MoSCoW choisi par Léa crée un « challenge » permanent dans le panneau, qui devient du bruit | faible |
| S17 | F6 : décision « action lancée » au lieu de « validation » | journal fidèle | nul |
| S18 | F7 : statut de l'insight dans l'en-tête du groupe du backlog, envoi refusé si l'insight n'est plus vivant | cohérence entre écrans | faible |
| S19 | G1 : `cancel_override` dans `apply_decision` | le chat peut revenir à la recommandation | moyen : nouveau type d'outil, à mesurer avec `eval:guardrails` |
| S20 | Écrans vides : remplacer « lance `pnpm pipeline:run` » par une phrase pour le PO, avec la commande en note | l'écran s'adresse au PO, pas au développeur | nul |

Ma recommandation avant l'évaluation : S11, S12, S13 et S14 (ce sont des corrections de comportement, chacune avec son test), plus S15 si tu veux. S16 à S20 selon ton avis. F3 est une ligne dans la checklist de démo.

### 12.5 Ce qui tient bien

- Les écritures du PO sont sous verrou, vérifiées par zod puis par `lib/scoring`, et journalisées. L'override égal à l'override actif est refusé. L'override de Reach est lié à son mode (les unités diffèrent). Le sujet manuel est contrôlé avant toute écriture.
- La fusion conserve la mémoire des items, recalcule les agrégats de la cible et re-classe en code sans appel de modèle. Le rejet archive le score.
- L'envoi Notion est idempotent (`notion_links`) et un échec reste rattrapable (« Réessayer »). Une page incomplète (blocs non ajoutés) est mise à la corbeille plutôt que laissée dans le kanban.
- Le chat gère une carte périmée (409), une modification invalide (400, la carte reste affichée), un message écrit à la place d'une réponse à la carte (résultats synthétiques), le double clic (carte retirée avant l'envoi) et un changement de fil pendant une réponse (la réponse se termine côté serveur).
- La liste Retours gère une page au-delà de la dernière (redirection), et les flèches ← → ne naviguent pas quand le focus est dans un champ.
- Le chat et l'écran partagent les mêmes services (priorisation, revue, backlog, Notion) : il n'y a pas de double implémentation des règles.

### 12.6 Limites d'échelle (à documenter en 8.2, SPEC §17.2)

`computeStoredRanking` (écran Priorisation, `get_priority`, chaque override) relit à chaque appel tous les retours (texte brut compris), les items, les comptes, les analyses et les overrides. C'est instantané à 214 retours, linéaire au-delà : à 10 000 retours, chaque affichage de Priorisation transférerait des dizaines de Mo. `getInsightsScreen` et `query_customers` lisent aussi des tables entières. Il faudrait des agrégats matérialisés et des signaux stockés.

---

## 13. Suivi (complété en fin de session)

_En attente de validation._

**Mise à jour du 8 octobre 2026, après les commits `f9c4a61` à `23b19cc` (Haiku 5.5 comme modèle de comparaison du triage, écran Évals) :**

- **E1 est réglé** : EVALS.md affiche le triage mesuré avec Sonnet (90,3 % ✅, F1 0,911 ✅). On le retire des lots et de la liste 8.2.
- **Q2 reste valable**, et devient plus visible : le rôle `triage` désigne maintenant Haiku 5.5, alors que le pipeline trie avec Sonnet.
- **Q1 reste valable** : `src/app/evals/page.tsx` a été réécrite et ne déclare toujours pas `dynamic`.
- **À ajouter** :
  - le tableau des modèles de CLAUDE.md indique encore `claude-haiku-4-5-20251001` ;
  - l'éval « Triage : cas limites E1 à E8 » date du 6 octobre et a été mesurée avec l'ancien Haiku, à relancer sur Sonnet (coût à annoncer) ;
  - ARCHITECTURE.md indique toujours « triage · Haiku » (§9, point 2).
- **Numéros de ligne** : ceux de cette note sont périmés pour les fichiers d'evals et de `src/lib/llm`. Retrouver les endroits par nom de fonction ou de constante.
- **Mise en œuvre** : par lots, chacun sur une branche partie de `main` à jour.
  - **Lot A (sans risque)** : S1 à S4, S6 à S8, S11, S14, S17, F11.
  - **Lot B (documentation)** : §11.
  - **Lot C (interface)** : S12, S13, S18, S20.
  - **Plus tard, ou avec une éval** : S5, S15, S16, S19. S10 est écarté.
- **A1 est à relire** : le prompt système cite bien « estimation » dans sa liste `load_skill`. Seule « rédaction » contredit la description de l'outil.
