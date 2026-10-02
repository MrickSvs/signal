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
