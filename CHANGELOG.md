# Changelog — Signal

Suivi de l'avancement pour un relecteur technique. Une entrée par étape de [PLAN.md](PLAN.md), la plus récente en haut.
Pour le détail : le **pourquoi** des choix est dans [docs/DECISIONS.md](docs/DECISIONS.md) (ADR), les durées et coûts dans [docs/BUILD_LOG.md](docs/BUILD_LOG.md), le **quoi** dans [SPEC.md](SPEC.md), les règles de travail dans [CLAUDE.md](CLAUDE.md).

## État actuel

- **Phase 0 (fondations) terminée** : étapes 0.1 à 0.3. Prochaine étape : 1.1 (pack de contexte Jalon).
- App déployée sur Vercel (production, protégée par Basic Auth) : https://signal-coral-two.vercel.app — encore une page « en construction ».
- CI GitHub Actions verte (lint, typecheck, tests, sans aucune clé).
- Coût LLM cumulé : ~0,002 €.

## Points d'attention

- **Écart avec PLAN 0.3 — températures** : Sonnet 5.5 et Opus 5.5 rejettent toute `temperature` non par défaut. Seul le triage (Haiku) a `temperature: 0` ; les autres rôles tournent en réflexion adaptive. Conséquence pour 6.3 : la stabilité du juge repose sur la calibration, pas sur la température. → ADR-003
- **Sorties structurées** : natives (`output_config.format`), pas d'appel d'outil forcé (refusé par Sonnet/Opus 5.5). Tout passe par `invokeStructured()`. → ADR-003
- **Cache de prompt sur Haiku** : préfixe minimal de 4 096 tokens. À vérifier en 2.1 : le préfixe du triage (skill + product.md) doit dépasser ce seuil, sinon le cache ne sert pas.
- **Séquences d'ID** : l'insertion de test de 0.2 a consommé `R-001`. Les seeds (1.3, 1.4) qui fixent des ID explicites devront recaler les séquences (`setval`).
- **Variables Vercel** : définies en **Production** seulement (pas Preview/Development). `DATABASE_URL` n'y est pas encore (utile en phase 4, checkpointer).
- **Langfuse** : compte récent, la lecture des traces passe par l'API `v2/observations` (l'API `traces` historique est fermée).

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
