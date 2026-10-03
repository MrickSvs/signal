# Stratégie produit

> Doc interne, validée en comité de direction. Le « trimestre en cours » désigne les 90 jours qui suivent `DEMO_NOW` : aucune date absolue ici.

## Vision

**Devenir le cockpit des agences** : piloter les projets _et_ embarquer leurs clients. Une agence ne vend pas des tâches, elle vend un résultat à un client qui veut savoir où on en est. Jalon doit être l'endroit où l'agence travaille et où son client vient voir l'avancement, au lieu des e-mails de suivi et des exports bricolés.

## Où on en est

- ~2 400 comptes, ~210 k€ de MRR (ARR ~2,5 M€). La moitié du MRR vient de ~30 comptes Enterprise (~110 k€), ~60 k€ du Business, ~40 k€ du Pro. Le Free ne rapporte rien mais alimente le Pro.
- Notre croissance tient aux agences. Notre risque tient à quelques gros comptes : perdre deux comptes Enterprise coûte plus que cent comptes Pro.
- Les concurrents généralistes sont plus riches en fonctionnalités ; notre avantage est la simplicité et le focus agence.

## Cibles

- **Agences** de communication et agences digitales, 5 à 300 personnes (cœur de cible).
- **Cabinets de conseil** qui gèrent des missions client.
- **PME de services** qui livrent des projets à des clients.

Le point commun : un client final à qui il faut rendre des comptes.

## Non-cibles explicites

- **Facturation / ERP** : on s'intègrera un jour, on ne le construit pas.
- **Suivi de temps avancé** (feuilles de temps, taux horaires, rentabilité) : marché occupé, hors de notre promesse.
- **Industrie et BTP** (et plus largement les segments `hors_cible`, dont le retail) : cycles, besoins et acheteurs différents.

Une demande qui ne sert qu'une non-cible est **hors stratégie**, même portée par un gros deal. Elle reste visible, avec son coût d'opportunité.

## OKRs du trimestre en cours

**O1 — Garder nos clients Business et Enterprise.**

- **O1-KR1** : churn MRR Business + Enterprise < 1,5 % par mois.
- **O1-KR2** : zéro compte Enterprise perdu au renouvellement.

**O2 — Faire de Jalon l'espace de collaboration agence ↔ client.**

- **O2-KR1** : 25 % des projets actifs avec au moins un invité client.
- **O2-KR2** : NPS agences ≥ 40.

**O3 — Fiabilité perçue.**

- **O3-KR1** : zéro incident de notification de plus de 24 h.
- **O3-KR2** : chargement du tableau < 1 s au p75.

Lecture pour la priorisation : O1 passe avant tout le reste ce trimestre (trois renouvellements Enterprise sensibles, voir `commitments.md`). O2 est le pari de fond. O3 est la condition pour que les deux autres tiennent.

## Paris stratégiques

1. **Le client final dans Jalon.** Permissions par projet, accès invité restreint, puis partage de l'avancement. C'est à la fois un engagement contractuel (Atelier Mercure), un frein au renouvellement (Groupe Hélix) et le cœur de O2. Prérequis : remettre les permissions à plat (voir `architecture.md`).
2. **Rendre compte plutôt qu'exporter.** Les clients demandent des exports Excel, des PDF, des liens : le besoin est de montrer l'avancement au client final. On le traite comme un problème, pas comme une liste de formats.
3. **Fiabilité avant fonctionnalités.** Une notification perdue ou un tableau lent coûte plus de confiance qu'une fonctionnalité absente.
4. **Rester simple en grandissant.** Les petits comptes trouvent Jalon déjà chargé ; les comptes Business veulent plus de personnalisation. On cherche la divulgation progressive, pas l'empilement d'options.

## Ce qu'on ne fera pas ce trimestre

- Facturation, suivi de temps, fonctionnalités spécifiques à l'industrie : même pour signer un prospect.
- Une vue Gantt complète : demandée surtout par des comptes Free et Pro, elle suppose des dates de début et des dépendances que le modèle de données n'a pas. À réévaluer au trimestre suivant.
- Application mobile, intégrations natives.
