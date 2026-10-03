# Skills de Jalon

Les savoir-faire métier, un dossier par skill avec un `SKILL.md` : frontmatter YAML (`name`, identique au dossier ; `description` d'une phrase qui dit **quand** l'utiliser), puis objectif, règles numérotées, gabarit ou échelle, bon et mauvais exemple, erreurs fréquentes.

Le pipeline et l'agent chargent les mêmes fichiers (`src/lib/skills.ts` : `listSkills()` pour l'index, `loadSkill(name)` pour le contenu). Modifier une skill change le comportement de Signal sans toucher au code.

| Skill             | Utilisée par                                 |
| ----------------- | -------------------------------------------- |
| `triage-taxonomy` | nœud `triage`                                |
| `rice-scoring`    | nœud `score` (Impact)                        |
| `moscow`          | nœud `score` (recommandation MoSCoW)         |
| `backlog-format`  | `draft_backlog_items`, `update_backlog_item` |
| `user-story`      | `draft_backlog_items`                        |
| `estimation`      | nœud `estimate`, `estimate_complexity`       |
| `challenge`       | agent (décisions du PO)                      |
| `digest`          | nœud `digest`                                |
| `prototype`       | `generate_prototype`                         |
