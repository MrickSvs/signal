# Changelog — Signal

Suivi de l'avancement pour un relecteur technique. Une entrée par étape de [PLAN.md](PLAN.md), la plus récente en haut.
Pour le détail : le **pourquoi** des choix est dans [docs/DECISIONS.md](docs/DECISIONS.md) (ADR), les durées et coûts dans [docs/BUILD_LOG.md](docs/BUILD_LOG.md), le **quoi** dans [SPEC.md](SPEC.md), les règles de travail dans [CLAUDE.md](CLAUDE.md).

## État actuel

- **Phase 2 (pipeline) en cours** : 2.1 (triage) et 2.2 (rattachement aux comptes) faites. Prochaine étape : 2.3 (regroupement par problème).
- Base Supabase seedée : 90 clients + 5 prospects, 40 tickets de référence avec embeddings, 214 retours de développement, tous triés (222 items) et rattachés (203 à un compte, 11 sans compte identifiable). Le jeu réservé (77 retours) reste hors base.
- App déployée sur Vercel (production, protégée par Basic Auth) : https://signal-coral-two.vercel.app — encore une page « en construction ».
- CI GitHub Actions (lint, typecheck, tests, sans aucune clé) : 154 tests.
- Coût LLM cumulé : ~2,7 € (génération des tickets ~0,21 €, des retours ~2,1 €, triage ~0,34 €).

## Points d'attention

- **Écart avec PLAN 0.3 — températures** : Sonnet 5.5 et Opus 5.5 rejettent toute `temperature` non par défaut. Seul le triage (Haiku) a `temperature: 0` ; les autres rôles tournent en réflexion adaptive. Conséquence pour 6.3 : la stabilité du juge repose sur la calibration, pas sur la température. → ADR-003
- **Sorties structurées** : natives (`output_config.format`), pas d'appel d'outil forcé (refusé par Sonnet/Opus 5.5). Tout passe par `invokeStructured()`. → ADR-003
- **Cache de prompt sur Haiku** : vérifié en 2.1, le préfixe du triage (~5 900 tokens) dépasse le minimum de 4 096 ; le run complet lit le cache à chaque appel. → ADR-008
- **Enums des sorties structurées** : jusqu'à 2.1, `transformJSONSchema` du SDK les retirait du schéma (ils n'étaient pas imposés). Corrigé dans `invokeStructured()` ; la nouvelle tentative après une sortie invalide reçoit maintenant les erreurs. → ADR-008
- **Seed et rattachement** : le seed ne charge le compte que pour les commentaires in-app et les NPS ; après tout `db:seed`, relancer `pnpm pipeline:enrich` (le graphe de 2.6 le fera). Les signaux business ne sont pas stockés, ils sont recalculés à la demande. → ADR-009
- **Sentiment du triage** : le signe ne correspond à la vérité terrain que pour 162 retours sur 214 ; les retours neutres sortent souvent à −1 ou +1. À mesurer et corriger avec `eval:triage` (6.2), pas avant.
- **Volumes du jeu de données revus** (décision du PO) : bruit ~100 au lieu de ~140, soit 214 retours au lieu de ~265 ; SPEC §1 dit « plus de 150 retours par mois ». Volumes des patterns inchangés. → ADR-006
- **Seuil d'analogue proche** : 0,45 et non 0,6, d'après les similarités mesurées sur voyage-4 (permissions 0,49–0,52, notifications 0,45–0,56, suivi du temps ≤ 0,37). À confirmer en 2.4. → ADR-005
- **Vérité terrain enrichie** par rapport à PLAN 1.4 : `topic` (sujet de bruit), `acceptable_areas` (domaine ambigu) et `churn_signal`. Le runner `eval:triage` (6.2) doit en tenir compte. Les retours réservés ont des ID `H-001`…, pas `R-`. → ADR-007
- **Régénérer les retours** : le cache `.cache/feedback-texts/` évite de repayer, mais modifier un angle de `scenario.yaml` invalide tout le jeu réservé (~0,7 €). Le test des fichiers versionnés échoue tant qu'ils ne suivent plus le plan. → ADR-007
- **Heure du seed** : un retour « du jour » est placé avant l'instant du seed ; seedé la nuit, il tombe hors des heures de bureau. Seeder en journée avant une démo.
- **Variables Vercel** : définies en **Production** seulement (pas Preview/Development). `DATABASE_URL` n'y est pas encore (utile en phase 4, checkpointer).
- **Langfuse** : compte récent, la lecture des traces passe par l'API `v2/observations` (l'API `traces` historique est fermée).

## [2.2] Rattachement client et signaux business — 2026-10-03

ADR-009

- `src/pipeline/nodes/enrich.ts` (sans LLM) : compte connu, sinon domaine de l'e-mail (jamais une messagerie grand public ni `jalon.fr`), sinon nom de compte cité dans une note interne (exact, cœur du nom, puis approché), sinon aucun. Signaux par retour : plan, segment, MRR, jours avant renouvellement, prospect, poids de la source, `account_key` pour compter les comptes distincts.
- Seed rendu réaliste (décision du PO) : seuls les commentaires in-app et les NPS arrivent avec leur compte.
- `pnpm pipeline:enrich` : 214/214 retours rattachés comme prévu par le plan ; S2b sur les bons comptes, S4 sur le prospect Forgeval, E7 sans compte, relances E2 sous une seule clé.

## [2.1] Triage des retours — 2026-10-03

ADR-008

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
