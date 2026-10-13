# Pas de résolution de conflits au niveau branche

**Statut : remplacé (phase F, 2026-10)** — les branches et commits du backend sont supprimés avec lui. Voir [editor-web-server](editor-web-server.md).

**Status :** accepted (2026-06-17)

## Décision

Artisan **ne fait pas de merge 3-way ni de résolution de conflits entre branches**. Le moteur `mergeEngine` (`merge()` / `applyResolutions()`), les endpoints `POST …/branches/:src/merge-into/:dst` + `…/resolve`, et les fonctions client `mergeBranches` / `resolveMerge` ont été retirés (cf. CHANGELOG `[Unreleased]`, 2026-06-17).

Le modèle de branches reste **linéaire / fast-forward only** :

- `commits` (snapshot du WIP sur une branche), `history` (liste + restore d'un commit passé), `revert` (restore du head), `deploy` (broadcast du bundle) — **conservés, utilisés**.
- `promote/:dst` — avancement **fast-forward only** (`409 not_fast_forward` si divergence), **conservé** pour le futur flux dev→prod.
- Primitives DAG (`pack_commits.parentId2`, `branchStorage.findLCA`) — **conservées mais inertes** : aucun consommateur tant qu'on ne réintroduit pas de merge.

## Pourquoi

1. **Personne ne le câblait.** Le sous-système était implémenté de bout en bout côté backend (moteur + endpoints + tests) et côté client API, mais **aucun composant de l'éditeur n'appelait `mergeBranches` / `resolveMerge`**. Il n'existait pas d'interface de résolution de conflits. Test de suppression net : retirer le code fait disparaître la complexité sans qu'elle réapparaisse ailleurs.

2. **La concurrence live est déjà résolue autrement.** L'ADR `editor-state-model` a tranché : backend autoritaire + **last-writer-wins** + indicateur de présence, pas de lock. Quand deux admins éditent en même temps, c'est le modèle temps-réel qui réconcilie. Une résolution de conflits au niveau branche résoudrait un problème que la collaboration live résout déjà.

3. **Le cas d'usage envisagé n'en avait pas besoin non plus.** L'intention initiale était une branche `dev` (serveur de test) et une branche `main` (prod) pour un même pack. Ce flux est *linéaire* : on édite sur `dev`, puis on pousse `dev → main`. `main` ne reçoit que des promotions, ne diverge jamais seul → **fast-forward**, jamais de merge 3-way. Les conflits n'apparaîtraient que si `main` était édité directement *pendant* que `dev` diverge — ce que le workflow ne fait pas. Et ce cas d'usage a de toute façon été différé.

## Conséquences

- **Si le besoin de branches dev/prod revient**, il se construit avec `promote` (fast-forward only). Aucun merge 3-way à réintroduire.
- **Si un jour deux branches doivent réellement diverger** (édition simultanée des deux côtés, isolée), alors seulement ré-ouvrir cette décision : restaurer un moteur de merge depuis l'historique git (commit de retrait du 2026-06-17) et **concevoir l'UI de résolution en même temps** que le moteur, contre un vrai consommateur.
- Les colonnes / primitives DAG restent en place (pas de migration DB) — elles ne coûtent rien et évitent un aller-retour de schéma si les branches reviennent.

## Alternatives écartées

- **Garder le code dormant « au cas où ».** Rejeté : du code testé mais sans appelant est un piège pour la prochaine session (humaine ou agent) qui croit devoir le câbler. Git le rend si jamais.
- **Déprofondir le moteur de merge** (consolider la classification + le double-merge éparpillés dans les routes en un module `planMerge`/`resolveMerge`). Sans objet une fois la feature supprimée — c'était la piste initiale de la revue d'archi, abandonnée au profit de la suppression.
