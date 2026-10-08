# Signal

[![CI](https://github.com/MrickSvs/signal/actions/workflows/ci.yml/badge.svg)](https://github.com/MrickSvs/signal/actions/workflows/ci.yml)

L'agent IA du Product Owner de Jalon. Le quoi et le pourquoi sont dans [SPEC.md](SPEC.md), l'ordre de construction dans [docs/process/PLAN.md](docs/process/PLAN.md), l'avancement dans [CHANGELOG.md](CHANGELOG.md). Ce README sera complété à l'étape 8.2.

## Notion

Signal envoie dans Notion les éléments du backlog que le PO a validés, et seulement eux, dans un seul sens (SPEC §11, ADR-026). Une base suffit : **Backlog**, avec sa vue kanban groupée par Statut.

1. **Créer l'intégration** : [notion.so/profile/integrations](https://www.notion.so/profile/integrations) → nouvelle intégration interne, capacités « Lire », « Mettre à jour » et « Insérer du contenu ». Copier le jeton dans `NOTION_TOKEN`.
2. **Partager la page parente** : créer une page « Jalon — Produit (Signal) », puis ••• → Connexions → ajouter l'intégration. Copier l'ID de la page (les 32 caractères à la fin de son URL) dans `NOTION_PARENT_PAGE_ID`.
3. **Lancer le setup** :

   ```bash
   pnpm notion:setup
   ```

   Il crée la base Backlog (Nom, ID, Type, Statut, Epic, Insight, MoSCoW, Points, Énoncé, Prototype, Lien Signal, Validé le) et la vue « Kanban » groupée par Statut, puis affiche `NOTION_DS_BACKLOG=…` à copier dans `.env` et sur Vercel. Relancé, il ne recrée rien et ajoute seulement les propriétés manquantes.

4. **Si la vue kanban n'a pas pu être créée** (le script le signale) : dans la base, « + Ajouter une vue » → Tableau → Grouper par « Statut ».

L'envoi se fait depuis le chat (« Envoie US-004 dans Notion », carte d'approbation) ou depuis l'écran Backlog (« Valider et envoyer »). En cas d'échec, l'élément reste « validé » avec l'erreur et un bouton « Réessayer ». Une fois envoyé, il se modifie dans Notion.
