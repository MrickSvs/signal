Scénario, clients, retours, tickets de référence et données de démo. Fichiers versionnés, sans aucune date absolue : les dates sont calculées au seed à partir de `DEMO_NOW`.

| Fichier                  | Produit par                                                    | Contenu                                                                                         |
| ------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `customers.csv`          | `pnpm tsx scripts/generate-customers.ts` (seed fixe, sans LLM) | 90 clients et 5 prospects ; `renewal_in_days` = jours entre `DEMO_NOW` et le renouvellement     |
| `reference_tickets.json` | `pnpm tsx scripts/generate-reference-tickets.ts` (≈ 0,2 €)     | 40 tickets livrés (T-101 à T-140) ; `shipped_days_ago` = jours entre la livraison et `DEMO_NOW` |

`pnpm db:seed` les charge dans Supabase (upsert par ID, embeddings des tickets recalculés seulement si leur texte change, séquences d'ID recalées par `sync_id_sequence`).

Les chiffres des tickets (module, composants, points estimés et réels, jours, date) sont planifiés dans le code du générateur ; le modèle n'écrit que le texte. Les tickets cités dans le contexte (T-104, T-108, T-112, T-117, T-121, T-124, T-130) sont écrits à la main dans ce plan.
