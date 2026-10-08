# Signal

[![CI](https://github.com/MrickSvs/signal/actions/workflows/ci.yml/badge.svg)](https://github.com/MrickSvs/signal/actions/workflows/ci.yml)

**Signal filtre le bruit.** C'est l'agent IA de Léa, Product Owner de Jalon, un SaaS fictif de gestion de projet pour agences.
Il lit les retours clients de sept canaux, les découpe par sujet et les regroupe par problème, pas par solution demandée.
Il chiffre chaque sujet (RICE calculé en code, valeur business, MoSCoW sous règles dures), défend son classement preuves à l'appui et challenge une décision qui les contredit.
Il rédige le backlog (stories, bugs, tâches techniques, critères Gherkin, points estimés par analogie) et l'envoie dans le kanban Notion de l'équipe.
Signal recommande, le PO décide : toute décision et toute écriture externe passent par sa validation, et chaque chiffre ouvre sa preuve.

- **Démo déployée** : [signal-coral-two.vercel.app](https://signal-coral-two.vercel.app), protégée par mot de passe (communiqué à part ; n'importe quel nom d'utilisateur).
- **Pour aller plus loin** : [SPEC.md](SPEC.md) (quoi et pourquoi), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/DECISIONS.md](docs/DECISIONS.md) (44 ADR), [docs/EVALS.md](docs/EVALS.md), [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md). La méthode de construction est dans [docs/process/](docs/process/) (plan, journal, revue).

## Captures

Les captures vont dans `docs/img/`, qui n'existe pas encore. Emplacements attendus, sur la base de démo (`pnpm demo:reset`, puis `pnpm digest`), à 1 280 × 800 :

| Fichier | Écran | État |
| --- | --- | --- |
| `docs/img/01-digest.png` | Digest | Après le digest du matin : « À traiter » (trois recommandations) et « Ce qui bouge » (I-57 et I-56 émergents, comptes à risque) |
| `docs/img/02-digest-generation.png` | Digest | Pendant « Régénérer ce digest » : le panneau des étapes (Période, Faits, Mémoire, Rédaction, Enregistré) |
| `docs/img/03-insight-s1.png` | Détail de I-55 | Bande de chiffres clés et répartition sur quatre canaux |
| `docs/img/04-insight-s3.png` | Détail de I-56 | « Ce qu'ils demandent / Ce dont ils ont besoin » |
| `docs/img/05-priorisation-comptes.png` | Priorisation | Reach « Comptes » : I-54 (Gantt) 2e, I-59 (permissions) 8e, Must |
| `docs/img/06-priorisation-mrr.png` | Priorisation | Reach « MRR » : I-59 3e, I-54 7e |
| `docs/img/07-chat-trace.png` | Chat, onglet Trace | « Prépare les stories des permissions » : outils, skills, coût du tour |
| `docs/img/08-carte-approbation.png` | Chat | Carte d'approbation d'un envoi dans Notion, avec l'aperçu des pages |
| `docs/img/09-backlog.png` | Backlog | Epic de I-59 et une story dépliée (Gherkin, estimation, badge du juge) |
| `docs/img/10-notion-kanban.png` | Notion | Vue Kanban de la base Backlog, colonne « Prêt » |
| `docs/img/11-alerte-dossier.png` | En-tête, liste des alertes | Alerte churn de Studio Bastide (retour 2 de `data/demo/retours-a-coller.md`) et son dossier |
| `docs/img/12-evals.png` | Évals | Les quatre groupes de cartes |

## Ce qu'il y a dedans

- **Un pipeline** (workflow LangGraph) : triage et découpage des retours en items (Sonnet), rattachement aux comptes, vecteurs Voyage, regroupement agglomératif sur le problème, appariement entre deux runs, étiquetage, estimation par analogie, score, alertes, digest. Run complet en CLI, mode incrémental par route API.
- **Un agent unique** (LangChain v1 `createAgent`) avec 14 outils, un briefing calculé en code à chaque tour, une validation humaine par middleware (carte d'approbation, reprise depuis un checkpointer Postgres) et des enquêtes en lecture seule sur les alertes.
- **Un cockpit** Next.js : Digest, Retours, Insights, Priorisation, Backlog, Évals, Contexte, et le chat avec sa trace en direct.
- **Des evals** rejouables (triage sur un jeu réservé, détection des patterns, estimation en leave-one-out, stabilité, garde-fous, juge Opus calibré sur les annotations du PO).

Détail : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Installation

Compter une heure, dont la moitié pour créer les comptes. Toutes les commandes se lancent à la racine du repo.

### 1. Prérequis et comptes

- **Node 22** (`.nvmrc`) et **pnpm 12** (`packageManager` de `package.json` : `corepack enable` suffit). Le CLI Supabase est une dépendance du projet (`pnpm exec supabase`).
- **Anthropic** : une clé API, et un plafond de dépense dans la console.
- **Voyage AI** : une clé API. Sans moyen de paiement, l'API est limitée à 3 requêtes par minute (les 200 M tokens gratuits restent gratuits avec un moyen de paiement).
- **Supabase** : un projet (région UE), et son mot de passe de base (demandé par `supabase link`). L'extension `vector` est créée par la première migration. L'URL et la clé `service_role` sont dans les paramètres d'API du projet ; `DATABASE_URL` est la chaîne du **pooler en mode session** (bouton « Connect » du projet).
- **Langfuse** (facultatif, plan Hobby) : sans clés, rien n'est tracé et tout fonctionne.
- **Notion** (facultatif) : sans Notion, on valide et on rejette les brouillons depuis l'écran Backlog ; seul l'envoi manque.
- **Vercel** (facultatif) : pour déployer ; tout tourne aussi en local.

### 2. Code et variables

```bash
git clone https://github.com/MrickSvs/signal.git && cd signal
pnpm install --frozen-lockfile
cp .env.example .env
```

Renseigner `.env` (chaque variable y est commentée ; valeurs sans guillemets, en local comme sur Vercel : une `LANGFUSE_BASE_URL` entre guillemets a déjà cassé toutes les routes serveur en production) :

| Variable | Pour | Obligatoire |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Modèles Claude | oui (pipeline, chat, digest, evals) |
| `VOYAGE_API_KEY` | Embeddings | oui (seed, pipeline, recherche par le sens) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Base, côté serveur uniquement | oui |
| `DATABASE_URL` | Verrou du pipeline et mémoire du chat : le **pooler en mode session** (port 5432, IPv4), pas la connexion directe (IPv6 seulement) ni le mode transaction (6543) | oui |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `LANGFUSE_TRACING_ENVIRONMENT` | Traces, coûts, datasets d'evals | non |
| `NOTION_TOKEN`, `NOTION_PARENT_PAGE_ID`, `NOTION_DS_BACKLOG` | Envoi du backlog validé | non |
| `SITE_PASSWORD` | Basic Auth de l'app (vide : pas de mot de passe) | non |
| `APP_BASE_URL` | Liens poussés dans Notion | avec Notion |
| `CRON_SECRET` | Route du cron quotidien | en déploiement |
| `DEMO_NOW` | Date de référence du scénario (vide : maintenant) | non, laisser vide |

### 3. Base

```bash
pnpm exec supabase login
pnpm exec supabase link --project-ref <ref du projet>
pnpm db:push        # applique les 8 migrations de supabase/migrations/
pnpm db:seed        # 90 clients et 5 prospects, 40 tickets de référence (vectorisés par Voyage), 214 retours
```

Le schéma `langgraph` (mémoire du chat, reprise du pipeline) est créé au premier usage.

### 4. Données : la base de démo, ou un run complet

**Base de démo (recommandé, ~20 s, sans appel de modèle)** : restaure le snapshot versionné dans `data/demo-snapshot/` (214 retours triés, 26 insights déjà revus par le PO dont 25 actifs, scores, estimations), puis écrit le premier digest.

```bash
pnpm demo:reset     # ~15 s, dates recalées sur aujourd'hui (jours du calendrier de Paris)
pnpm digest         # ~15 s, ~0,03 €
```

Lancer `pnpm digest` avant d'ouvrir l'écran Digest : chaque visite de cet écran compte comme une visite de Léa, et le digest suivant ne couvre que ce qui s'est passé depuis.

**Ou tout recalculer** : `pnpm pipeline:run` (mesuré le 7 octobre : 214 retours, 410 s, **2,52 €** ; `--resume <run_id>` reprend un run interrompu). Les insights naissent « à valider » : écran Insights, « Tout accepter » ou revue une à une.

### 5. Lancer

```bash
pnpm dev            # http://localhost:3000
```

Sans `SITE_PASSWORD`, aucun mot de passe n'est demandé. Après une modification de l'agent (prompt, outils), redémarrer `pnpm dev` : l'agent compilé est gardé en mémoire.

### 6. Notion (facultatif)

Signal envoie dans Notion les éléments du backlog que le PO a validés, et seulement eux, dans un seul sens (SPEC §11, ADR-026). Une base suffit : **Backlog**, avec sa vue kanban groupée par Statut.

1. **Créer l'intégration** : [notion.so/profile/integrations](https://www.notion.so/profile/integrations) → nouvelle intégration interne, capacités « Lire », « Mettre à jour » et « Insérer du contenu ». Copier le jeton dans `NOTION_TOKEN`.
2. **Partager la page parente** : créer une page « Jalon — Produit (Signal) », puis ••• → Connexions → ajouter l'intégration. Copier l'ID de la page (les 32 caractères à la fin de son URL) dans `NOTION_PARENT_PAGE_ID`.
3. **Lancer le setup** :

   ```bash
   pnpm notion:setup
   ```

   Il crée la base Backlog (Nom, ID, Type, Statut, Epic, Insight, MoSCoW, Points, Énoncé, Prototype, Lien Signal, Validé le) et la vue « Kanban » groupée par Statut, puis affiche `NOTION_DS_BACKLOG=…` à copier dans `.env` (et sur Vercel). Relancé, il ne recrée rien et ajoute seulement les propriétés manquantes.

4. **Si la vue kanban n'a pas pu être créée** (le script le signale) : dans la base, « + Ajouter une vue » → Tableau → Grouper par « Statut ».

L'envoi se fait depuis le chat (« Envoie US-004 dans Notion », carte d'approbation) ou depuis l'écran Backlog (« Valider et envoyer »). En cas d'échec, l'élément reste « validé » avec l'erreur et un bouton « Réessayer ». Une fois envoyé, il se modifie dans Notion.

### 7. Déployer (facultatif)

Projet Vercel à la racine du repo, Fluid compute (300 s au plus par fonction), région `dub1` et cron quotidien déclarés dans `vercel.json`. Reporter les variables dans Vercel, pour chaque environnement qui doit tourner : sur le projet actuel, elles ne sont définies qu'en Production, et un déploiement Preview tourne sans base ni clés. Les runs complets du pipeline restent en CLI.

## Commandes

Le tableau complet, avec les options, est dans [CLAUDE.md](CLAUDE.md#commandes).

| Commande | Effet |
| --- | --- |
| `pnpm dev` | Lancer l'app |
| `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm test:coverage` | Qualité (aucune clé nécessaire) |
| `pnpm db:push` · `pnpm db:seed` · `pnpm db:types` | Base |
| `pnpm pipeline:run` · `pipeline:triage` · `pipeline:enrich` · `pipeline:cluster` · `pipeline:score` · `pnpm digest` | Pipeline, en entier ou nœud par nœud |
| `pnpm chat` · `pnpm investigate <alert_uuid>` (`--pending`) · `pnpm estimate I-xx` | L'agent, une enquête, une estimation, en terminal |
| `pnpm notion:setup` | Base Backlog dans Notion |
| `pnpm eval:*` | Evals (voir plus bas) |
| `pnpm demo:snapshot` · `pnpm demo:reset` (`--empty`) | Figer la base de démo, la restaurer (ou la vider) |
| `pnpm tsx scripts/build-time.ts` | Temps et coût LLM du build par phase, depuis le journal |

## Structure

```
.
├── SPEC.md · CLAUDE.md · README.md
├── src/
│   ├── app/                 # écrans et routes API (agent, pipeline incrémental, digest, cron)
│   ├── agent/               # agent unique, prompt système, briefing, middlewares, HITL, enquêtes
│   │   └── tools/           # un fichier par outil (14)
│   ├── pipeline/            # graphe LangGraph, mode incrémental, verrou ; nodes/ : un nœud par fichier
│   ├── services/            # priorisation, revue des insights, backlog, estimation, alertes, notion/
│   ├── server/              # queries/ (lectures) et actions/ (server actions)
│   ├── lib/                 # llm, embeddings, scoring, clustering, estimation, insights, judge, evals…
│   └── components/          # écrans, chat, puces d'aperçu, ui/ (shadcn)
├── scripts/                 # CLI : seed, génération, pipeline, chat, Notion, démo ; evals/ : runners
├── context/jalon/           # pack de contexte et 9 skills
├── data/                    # scénario, clients, retours, tickets ; demo/ et demo-snapshot/
├── evals/                   # ground-truth/, holdout/, human-labels/, reports/ (lus par scripts/evals seulement)
├── supabase/migrations/     # 8 migrations, en ajout seulement
└── docs/                    # ARCHITECTURE, DECISIONS, EVALS, DEMO_SCRIPT ; process/ : PLAN, BUILD_LOG, REVIEW_NOTES
```

## Tests et evals

- `pnpm lint && pnpm typecheck && pnpm test` : **829 tests dans 101 fichiers**, sans aucun appel réseau (modèles, Voyage, Notion et Supabase simulés). `pnpm test:coverage` impose 100 % de couverture sur `lib/scoring`, `lib/clustering`, `match.ts` et `mappers.ts`. La CI (GitHub Actions) lance lint, typecheck et couverture, sans aucun secret.
- Les données d'évaluation (`evals/ground-truth/`, `evals/holdout/`) ne sont lisibles que par `scripts/evals/` : règle ESLint et test.
- Evals : `pnpm eval:triage` (`--compare`, `--edge`, `--model sonnet`), `eval:detection`, `eval:estimation`, `eval:stability`, `eval:guardrails` (`--tools`), `eval:judge-calibration`, `eval:backlog`. Elles appellent les vrais modèles : chaque runner annonce son coût et exige `--yes` au-delà de 1 €. Résultats, dates et ce qui n'est pas mesuré : [docs/EVALS.md](docs/EVALS.md), et l'écran Évals.

## Limites connues

### Pour passer en production (SPEC §17.2)

Masquage des données personnelles avant les modèles et registre RGPD (ici tout est fictif) ; souveraineté (API hors UE) ; connecteurs réels (Zendesk, Intercom, Gmail) ; un pack de contexte par produit et des droits d'accès ; synchronisation retour avec l'outil de l'équipe (champs, conflits, pages archivées) ; d'autres sources que les retours (analytics, dette technique) ; recalibrage des recommandations sur les décisions du PO ; estimation affinée par la lecture du vrai code.

**Échelle** (`REVIEW_NOTES` §12.6). Le classement (`computeStoredRanking`, appelé par l'écran Priorisation, `get_priority` et chaque override) relit à chaque appel tous les retours, texte brut compris, les items, les comptes, les analyses et les overrides : instantané à 214 retours, linéaire au-delà (à 10 000 retours, des dizaines de Mo par affichage). L'écran Insights et `query_customers` lisent aussi des tables entières. Il faudrait des agrégats matérialisés et des signaux stockés. Le clustering agglomératif convient jusqu'à quelques milliers d'items ; au-delà, un clustering incrémental.

### Non construit

- **Prototype** d'une story (SPEC §13) et l'outil `generate_prototype` : reportés (ADR-031). L'agent a 14 outils sur les 15 prévus.
- **Exposition MCP** (SPEC §10.9) et page **`/status`** : coupées (ADR-031). La mise en pause de Supabase est évitée par le cron quotidien.
- **Retour du statut Notion** (SPEC §11.3) : rien ne revient de Notion ; `list_backlog` rend `statut_notion: null`.

### Cas limites non traités (SPEC §19)

- Notion hors périmètre (ADR-026) : page archivée ou supprimée dans Notion (CL-37), page créée directement dans Notion (CL-38), points hors Fibonacci (CL-39).
- Un sujet rejeté qui revient avec de nouveaux retours ne lève aucune alerte (CL-62).
- Rédaction concurrente du même insight depuis le chat et l'écran : la rédaction insère hors du verrou, deux backlogs peuvent coexister (CL-65).
- Une alerte ignorée puis un nouveau retour du même compte dans les 24 h créent une nouvelle alerte et une nouvelle enquête (CL-66, assumé).
- Conversation de plus de 30 messages : le résumé réécrit l'historique ; testé en simulation seulement, à vérifier à la main sur Sonnet 5.5 (CL-30).

### Dettes ouvertes

Relevées dans [BUILD_LOG](docs/process/BUILD_LOG.md) et dans le suivi de la revue ([REVIEW_NOTES](docs/process/REVIEW_NOTES.md) §13) :

- La carte d'approbation du chat ne signale pas les brouillons d'un insight qu'on rejette ou fusionne (l'écran Insights les nomme).
- On peut valider, sans l'envoyer, un brouillon dont l'insight est rejeté (seul l'envoi est refusé).
- Le remplacement d'un override de Reach saisi dans l'autre mode n'est pas journalisé.
- La CLI `pnpm pipeline:cluster` écrit des fusions que le digest ne lit pas.
- `loadBriefingFacts` mélange deux horloges (scénario et heure réelle) si `DEMO_NOW` est défini ; `touchThread` et `answerAlert` datent en heure réelle.
- La recherche de l'écran Retours est lexicale (`ilike`) ; seul l'agent cherche par le sens.
- « Ajouter un retour » n'a pas de champ e-mail : le rattachement par domaine d'e-mail est impossible depuis l'écran, on choisit le compte à la main.
- La page Digest vide enregistre la visite de Léa : un premier digest généré depuis cette page ne couvre que les secondes écoulées depuis l'ouverture. Contournement : `pnpm digest` avant toute visite (procédure de [DEMO_SCRIPT](docs/DEMO_SCRIPT.md)).
- La description de l'outil `load_skill` cite encore « rédaction » parmi les tâches qui demandent une skill, contrairement au prompt système (SPEC §10.5 suit le prompt) : à aligner, puis à mesurer avec `eval:guardrails --tools`.
- Latences au-dessus du budget de SPEC §15 : ajout d'un retour 15 à 25 s mesurés en local (budget 15 s, jamais remesuré depuis Vercel) ; rédaction du backlog ~34 s (30 s). Le premier token du chat (< 3 s) n'a pas été mesuré.
- Écritures du pipeline non transactionnelles ; pas de transaction entre une décision et son désaccord ; une alerte enrichie garde son premier dossier.
- Validation humaine : sur deux cartes, le modèle a inventé la raison de Léa ; la consigne a été durcie, sans revérification en réel.
- Evals non mesurées : choix d'outil et enquête, backlog ; estimation sur 10 tickets sur 40 et stabilité sur 1 run ; cas limites E1 à E8 mesurés avec l'ancien Haiku 4.5, pas avec Sonnet qui trie aujourd'hui (détail dans [EVALS.md](docs/EVALS.md)).
- Couverture à 100 % sur le cœur déterministe seulement ; les autres modules déterministes sont testés sans seuil.
- Le message d'erreur d'envoi « NOTION_DS_BACKLOG manque » reste technique.
- L'en-tête de `scripts/pipeline-run.ts` annonce ~1,5 € par run complet (triage sur Haiku) ; mesuré sur Sonnet : 2,52 €.
- La navigation du détail d'un retour s'arrête aux bords de la page affichée (25 retours) ; pas de thème sombre.

## Comment il a été construit

Avec un agent de code (Claude Code), une étape de [PLAN](docs/process/PLAN.md) par session, chaque session notée dans le [journal](docs/process/BUILD_LOG.md) (durée, coût LLM, choix, dettes) et chaque choix d'architecture dans une ADR. `pnpm tsx scripts/build-time.ts` agrège le journal par phase.
