---
name: moscow
description: À utiliser pour recommander une catégorie MoSCoW (Must, Should, Could, Won't ce trimestre) à un insight classé et l'argumenter selon les règles dures, la stratégie et la capacité.
---

# MoSCoW

## Objectif

Recommander pour chaque insight classé une catégorie MoSCoW **pour le trimestre en cours** (les 90 jours qui suivent aujourd'hui), avec une justification que le PO peut défendre devant la direction et les sales. Le code applique ensuite des règles dures : si ta recommandation en viole une, il la corrige et le signale. Le MoSCoW final appartient au PO.

## Règles dures (appliquées en code, dans cet ordre)

| Ordre | Règle                    | Effet                                                                                                                                                                         |
| ----- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `engagement_contractuel` | Engagement contractuel dont l'échéance tombe dans les 90 jours (`commitments.md`) → **Must**                                                                                  |
| 2     | `hors_strategie`         | Insight hors stratégie sans engagement contractuel → **Won't**                                                                                                                |
| 3     | `signal_churn`           | Signal de churn d'au moins un compte Business ou Enterprise qui renouvelle dans moins de 90 jours ET Impact ≥ 2 → **Must**                                                    |
| 4     | `bug_critique`           | Bug d'urgence critique avec au moins 3 retours → **Must**                                                                                                                     |
| 5     | `quartiles`              | Premier quartile RICE et pas hors stratégie → **Should** ; aligné ou neutre hors premier quartile → **Could** ; Confidence 50 % et Reach dans le dernier quartile → **Won't** |

Les seuils exacts vivent dans `weighting.yaml` (section `moscow`).

## Règles de recommandation

1. **Applique les règles dans l'ordre.** La première règle qui s'applique fixe la catégorie ; les suivantes ne peuvent pas la contredire.
2. **Quand deux règles s'opposent**, suis l'ordre et **signale la tension** dans la justification, avec une piste qui sert la règle écartée. Exemple : un compte Enterprise à risque (règle 3) demande une fonctionnalité hors stratégie (règle 2) → Won't, tension signalée, piste : une action CSM (accompagnement, contournement, feuille de route partagée), pas un développement.
3. **Règle des 60 %** : l'effort cumulé des Must ne doit pas dépasser 60 % de la capacité roadmap du trimestre (`team.md`). Le code fait le calcul et lève l'alerte ; si on te la signale, propose quels Must rétrograder en Should, en commençant par ceux qu'aucune règle dure n'impose.
4. **Won't veut dire « pas ce trimestre »**, pas « jamais ». Dis ce qui ferait changer la décision (un engagement signé, un changement de cible).
5. **Justifie en 60 mots au plus** : la règle appliquée, les faits qui la déclenchent (compte, échéance en J+, OKR) et la tension éventuelle.
6. **Cite les OKRs** concernés par leur identifiant (`O1-KR2`) et les non-cibles de `strategy.md` quand l'insight est hors stratégie.
7. **Aucun chiffre calculé** : reprends les chiffres fournis (MRR, J+, rang), n'en produis pas.
8. **Un deal ne rend pas une non-cible stratégique.** Un prospect hors cible qui conditionne sa signature à une non-cible reste Won't, avec une recommandation argumentée pour les sales.

## Gabarit de sortie

```json
{
  "moscow_reco": "must | should | could | wont",
  "moscow_rationale": "Règle appliquée + faits déclencheurs + tension éventuelle + piste",
  "rules_considered": ["engagement_contractuel", "signal_churn"]
}
```

## Bon exemple

Insight « Je ne peux pas donner accès à un client sans lui ouvrir tout notre espace » (comptes Atelier Mercure, Studio Bastide, Groupe Hélix).

```json
{
  "moscow_reco": "must",
  "moscow_rationale": "Engagement contractuel Atelier Mercure : permissions par projet et invités à livrer avant J+75 (règle 1). Renforcé par le churn de Studio Bastide, renouvellement à J+38 (règle 3). Sert O1-KR2 et O2-KR1.",
  "rules_considered": ["engagement_contractuel", "signal_churn"]
}
```

## Bon exemple avec tension

Insight « Facturer et suivre le temps passé » porté par le prospect Forgeval Industrie.

```json
{
  "moscow_reco": "wont",
  "moscow_rationale": "Hors stratégie : facturation et suivi de temps sont des non-cibles, et Forgeval est un prospect industriel hors cible (règle 2). Aucun engagement signé. À revoir seulement si la cible change. Piste pour les sales : intégration avec un outil de facturation existant.",
  "rules_considered": ["hors_strategie"]
}
```

## Mauvais exemple commenté

```json
{
  "moscow_reco": "must",
  "moscow_rationale": "35 retours demandent un Gantt, c'est le sujet le plus demandé, il faut le faire en priorité. Effort total des Must : 22 semaines.",
  "rules_considered": []
}
```

- Aucune règle dure ne fait d'un Gantt demandé par des comptes Free et Pro un Must : le volume se reflète dans le Reach et le quartile, donc Should au mieux.
- « 22 semaines » est un calcul du modèle : interdit, la capacité est calculée en code.
- Aucune règle citée, aucun OKR, aucune piste.

## Erreurs fréquentes

- Mettre Must par sympathie pour un compte bruyant : seules les règles 1, 3 et 4 font un Must.
- Oublier qu'un engagement contractuel l'emporte sur tout, y compris sur un score faible.
- Taire une tension parce que la règle a tranché : le PO doit la voir.
- Confondre « Won't ce trimestre » et « rejeté » : l'insight reste visible et suivi.
- Proposer trop de Must sans regarder l'alerte de capacité.
