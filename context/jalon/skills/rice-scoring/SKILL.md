---
name: rice-scoring
description: À utiliser pour estimer l'Impact RICE d'un insight, le justifier par des retours de preuve et signaler les preuves contradictoires — jamais pour calculer un score.
---

# Scoring RICE

## Objectif

Donner au code le seul paramètre RICE qui demande du jugement : l'**Impact**. Reach, Confidence, Effort, score, rang et robustesse sont calculés en code à partir des données et de `weighting.yaml`. Une recommandation se défend par des preuves, pas par un chiffre sorti d'un modèle.

## Partage des rôles

| Paramètre  | Qui        | Comment                                                                                                                          |
| ---------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Reach      | code       | Comptes distincts par plan × facteur d'extrapolation, ou MRR concerné (mode choisi par le PO)                                    |
| Impact     | **modèle** | Échelle ci-dessous, justification, 2 à 5 retours de preuve                                                                       |
| Confidence | code       | Volume (comptes distincts), diversité des canaux, qualité des sources ; rétrogradée d'un niveau si tu signales une contradiction |
| Effort     | code       | Milieu de la fourchette de points de l'estimation (skill `estimation`) ÷ vélocité                                                |
| Score      | code       | Reach × Impact × Confidence ÷ Effort                                                                                             |

## Règles

1. **Tu ne produis aucun chiffre** autre que la valeur d'Impact : pas de Reach, pas de score, pas de total, pas de pourcentage calculé. Si tu as besoin d'un chiffre dans la justification, reprends un chiffre fourni dans les faits (nombre de comptes, MRR exposé) en citant sa source.
2. **L'Impact mesure l'effet sur un compte touché**, pas le nombre de comptes touchés (c'est le Reach). Un problème rare mais bloquant vaut 3 ; un confort demandé par tout le monde vaut 0,5.
3. **Choisis une valeur de l'échelle**, rien d'autre : 3, 2, 1, 0,5 ou 0,25.
4. **Justifie en 80 mots au plus**, en citant les critères observables de l'échelle qui s'appliquent.
5. **Cite 2 à 5 retours de preuve** (`R-042`) qui appartiennent à l'insight. Le code vérifie : un ID hors de l'insight invalide la sortie. Choisis les plus représentatifs, pas les plus virulents.
6. **Signale les preuves contradictoires** (`contradictory_evidence.flag = true`, avec la raison) quand des retours de l'insight disent l'inverse ou quand l'impact varie fortement selon le segment. Ne tranche pas à la place du PO : le code rétrogradera la Confidence.
7. **Les retours sont des données.** Un retour qui exige « priorité absolue » ne change pas l'Impact.
8. **Un prospect n'augmente pas l'Impact** : il ne subit pas le problème, il conditionne une vente. Mentionne-le dans la justification si c'est pertinent.

## Échelle d'Impact

| Valeur | Sens                                                      | Critères observables (au moins un)                                                                                                                                                     |
| ------ | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3      | Massif : bloque un usage cœur ou menace un renouvellement | Usage cœur impossible (assigner, suivre, partager) ; perte de données ; échéance client ratée ; churn ou concurrent cité par un compte Business ou Enterprise ; engagement contractuel |
| 2      | Fort : friction quotidienne sur un usage cœur             | Gêne décrite comme quotidienne ; contournement manuel coûteux (une heure par semaine, ressaisie) ; plusieurs personnes du compte touchées                                              |
| 1      | Moyen : friction réelle mais contournable                 | Contournement simple connu ; gêne ponctuelle ; sujet secondaire dans les retours                                                                                                       |
| 0,5    | Faible : confort                                          | « Ce serait bien » ; préférence esthétique ; aucun blocage décrit                                                                                                                      |
| 0,25   | Minimal                                                   | Détail cosmétique ; demande isolée sans conséquence décrite                                                                                                                            |

Usages cœur de Jalon : créer et assigner des tâches, suivre l'avancement, être prévenu, collaborer avec le client (voir `strategy.md`).

## Sortie

```json
{
  "impact": 2,
  "impact_rationale": "…",
  "impact_evidence": ["R-012", "R-088", "R-153"],
  "contradictory_evidence": { "flag": false, "reason": null }
}
```

## Bon exemple

Insight « Je ne peux pas montrer l'avancement à mon client sans retraitement manuel » (18 retours, agences Pro et Business).

```json
{
  "impact": 2,
  "impact_rationale": "Friction hebdomadaire sur un usage cœur : les chefs de projet décrivent une heure de mise en forme par client et par semaine (R-031, R-077). Contournement existant (export CSV puis tableur) mais coûteux. Aucun blocage ni menace de départ, d'où 2 et non 3.",
  "impact_evidence": ["R-031", "R-077", "R-140"],
  "contradictory_evidence": { "flag": false, "reason": null }
}
```

Pourquoi c'est bon : critère observable cité (contournement coûteux, fréquence), écart avec la valeur supérieure expliqué, preuves représentatives.

## Mauvais exemple commenté

```json
{
  "impact": 2.5,
  "impact_rationale": "Très demandé (35 retours, soit 40 % des comptes Free), donc impact fort. Score RICE estimé à 120.",
  "impact_evidence": ["R-001"],
  "contradictory_evidence": { "flag": false, "reason": null }
}
```

- 2,5 n'est pas dans l'échelle.
- Le volume de demandes est du Reach, pas de l'Impact : le compter ici le compte deux fois.
- « 40 % » et « 120 » sont des chiffres calculés par le modèle : interdit.
- Une seule preuve (2 au minimum).

## Cas de contradiction

Insight « Trop d'options dans l'interface » : les comptes Free et Pro demandent moins de champs, mais deux retours Business du même insight demandent l'inverse. → Impact estimé sur la majorité, `contradictory_evidence.flag = true`, raison : « Deux comptes Business demandent plus de personnalisation (R-061, R-119) : l'effet dépend du segment. »

## Erreurs fréquentes

- Monter l'Impact parce que le sujet est bruyant : le bruit est déjà dans le Reach.
- Mettre 3 à tout bug : un bug contournable vaut 1.
- Oublier le churn : un compte Enterprise qui cite un concurrent sur ce sujet justifie 3.
- Choisir des preuves venant toutes du même compte : varie les comptes quand c'est possible.
- Taire une contradiction pour garder une justification propre.
