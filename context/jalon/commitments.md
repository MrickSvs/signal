# Engagements contractuels et comptes sensibles

> Doc interne, tenue par les CSM et la PO, relue chaque semaine. Les échéances sont exprimées en **J+** à partir de `DEMO_NOW` (aujourd'hui). Aucune date absolue.

## Engagements contractuels

| Compte          | Engagement                                                       | Échéance | Statut       |
| --------------- | ---------------------------------------------------------------- | -------- | ------------ |
| Atelier Mercure | **Permissions par projet** et **accès invités restreint** livrés | J+75     | Non commencé |

- Signé au dernier renouvellement d'Atelier Mercure, en contrepartie d'un engagement d'un an.
- Échéance dans les 90 jours du trimestre en cours : tout insight couvert par cet engagement est **Must** (règle MoSCoW, `weighting.yaml`).
- Le renouvellement suivant (J+45) arrive **avant** l'échéance : le client attend de voir l'avancement d'ici là.

## Comptes sensibles

| Compte          | Plan       | Sièges | MRR     | Renouvellement | Santé  | Situation                                                                                        |
| --------------- | ---------- | ------ | ------- | -------------- | ------ | ------------------------------------------------------------------------------------------------ |
| Atelier Mercure | Enterprise | 140    | 4 200 € | J+45           | orange | Engagement contractuel ci-dessus. Suit l'avancement de près.                                     |
| Studio Bastide  | Enterprise | 90     | 2 700 € | J+38           | rouge  | Évoque un concurrent dans une note CSM. Renouvellement le plus proche.                           |
| Groupe Hélix    | Enterprise | 110    | 3 300 € | J+70           | orange | Bloqué sur le partage avec ses clients : ne peut pas inviter un client sans lui ouvrir l'espace. |

MRR cumulé exposé sur ces trois comptes : **10 200 €** par mois (~122 k€ par an), soit près de 10 % du MRR Enterprise.

## Prospect à surveiller

| Prospect           | Taille potentielle | Segment                  | Situation                                                                                         |
| ------------------ | ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------- |
| Forgeval Industrie | ~300 sièges        | `hors_cible` (industrie) | Les sales poussent **facturation** et **suivi de temps** pour signer. Deux non-cibles explicites. |

Un prospect ne compte pas dans le Reach (il n'est pas client) ; il apparaît dans les preuves et la justification. Les demandes de Forgeval sont hors stratégie : la réponse attendue est une recommandation argumentée (Won't ce trimestre), pas un développement.

## Règles de conduite

- Un retour d'un compte sensible est toujours lu par la PO, même s'il est isolé.
- Un signal de churn d'un compte Business ou Enterprise qui renouvelle dans moins de 90 jours déclenche une alerte (`weighting.yaml`, section `alerts`).
- Quand un compte sensible demande quelque chose hors stratégie, la piste par défaut est une action CSM (accompagnement, contournement, feuille de route partagée), pas un développement.
