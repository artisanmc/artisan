# Canonicalisation des schémas — un modèle, généré et enforced sur toutes les couches

**Statut :** design approuvé — **P1.0 en cours**. ⚠️ **MAJ 2026-06-08 :** le codegen **quicktype est écarté** (spike NO-GO : il aplatit nos unions discriminées en god-objects, pas de `sealed class` — cf. `docs/schema/CODEGEN.md`). Approche retenue : **types écrits à la main** (sealed Kotlin + unions TS) conformes au `schema.json` (source de vérité), **drift garanti par CI ajv + fixtures** (pas de génération). Les mentions « codegen / quicktype » ci-dessous se lisent désormais « types à la main + CI drift ».
**Auteur :** brainstorm 2026-06-08
**Déclencheur :** dérive découverte en préparant la feature IA (`2026-06-08-ai-assistant-design.md`).
**Code lié :** `docs/schema/*/v1/`, `editor/src/features/export/transform.ts` + `editor/src/domain/types.ts`, `plugin/src/main/kotlin/net/artisanmc/plugin/{engine,model}/`.

## Contexte — la dérive

En voulant faire de `menu/v1` le contrat de la feature IA, on a découvert que **trois représentations** d'un menu ont divergé, et que **rien ne les tient alignées** :

| | Où | État |
|---|---|---|
| **domain** | `editor/src/domain/types.ts` (accountStore, canvas) | projection d'édition : `LText` refs, step-trees, `canvasLayout`, camelCase, vocabulaire de conditions/actions **partiel** (+ `expression` que les autres n'ont pas) |
| **dialecte d'export** | sortie de `transform.ts` = **ce que le plugin lit réellement** | `{i18n:key}`, conditions `{type:"and", all:[…]}`, `if` collapsé, `size`, snake_case |
| **schéma documenté** | `docs/schema/*/v1/` | **périmé** : `of` partout, `if: Condition[]`, `title: string`, vocabulaire de 17 conditions / 15 actions |

Faits vérifiés dans le code :
- L'export (`serializeCondition`) **et** le plugin (`ConditionParser`) utilisent tous deux `and→all`, `or→any`, `not→of`, et acceptent un `if` collapsé (map) ou tableau. → **ils s'accordent ; `docs/schema` est le seul à dire `of`/tableau.**
- **Rien n'enforce** `docs/schema` : aucun `ajv`, aucune CI, le plugin (Jackson `@JsonIgnoreProperties`) ignore silencieusement les champs inconnus, l'éditeur ne valide pas non plus contre le schéma.
- Les **vocabulaires** de conditions et d'actions diffèrent entre les trois (domain partiel + `expression` ; plugin = superset typé ; docs = autre superset). Aucune source unique.

Conséquence : le contrat est implicite, non documenté fidèlement, non enforced, et redérive à chaque commit. C'est la dette de fondation à régler avant d'empiler des features (IA) dessus.

## Décisions du brainstorm

| Question | Choix |
|---|---|
| Périmètre | **Maximal** : canonicaliser tous les schémas (menu, command, dialog, translations, manifest/pack, template) + **codegen plugin**. |
| Garde-fou | Canonicalisation = **format / types / codegen / CI**. **Pas** de nouveaux comportements runtime. |
| Source de vérité | `docs/schema/<name>/v1/schema.json` (JSON Schema 2020-12), une par schéma. |
| Types depuis le schéma | ~~quicktype~~ → **écrits à la main** (sealed Kotlin + unions TS) conformes au `schema.json` ; drift par CI ajv + fixtures *(spike NO-GO 2026-06-08, cf. `docs/schema/CODEGEN.md`)*. |
| Domain éditeur | **Reste écrit à la main** (projection d'édition + sidecars i18n / canvas). |
| Phasage | **P1 = menu/v1** (débloque l'IA + le test prod), puis P2 (autres schémas), P3 (CI globale + retrait legacy). |

## Goals

- **Une source de vérité par schéma** (`schema.json`), dont sont **générés** les types Kotlin (plugin) et TS (export éditeur) → impossible de diverger par construction.
- **CI anti-dérive** : l'export de l'éditeur et les fixtures plugin sont validés contre `schema.json`, et le codegen est vérifié (regen + diff).
- **Vocabulaires réconciliés** : un seul ensemble canonique de conditions / actions / steps / title-layers par schéma.
- Le tout sans changer le comportement runtime existant.

## Non-goals (séparés, projets features à part)

- **Implémenter les branches `if` des clics côté plugin** : aujourd'hui `extractFromSteps` ne garde que `kind:"action"` et **jette les branches**. Le schéma canonique **inclut** les step-trees `kind: action|if` (constructs réels de l'éditeur) et les types générés les désérialisent, mais **les honorer au runtime = feature séparée** (TODO documenté).
- **Implémenter `context_inputs` / itération / data-sources côté plugin** : le schéma les inclut, le plugin ne les exécute pas encore. **Feature séparée** (TODO documenté).
- **Collapse `domain == menu/v1`** (supprimer le modèle interne de l'éditeur) : refactor bien plus gros, non requis. Le domain reste la projection d'édition.
- La feature IA elle-même (son spec attend la P1).

## Architecture cible

```
docs/schema/<name>/v1/schema.json   ← SOURCE DE VÉRITÉ unique (JSON Schema 2020-12)
        │  quicktype
        ├──────────────▶  plugin/.../generated/<Name>V1.kt   (sealed class)  ← parseurs plugin consomment
        └──────────────▶  editor/src/schema/<name>/v1.ts     (types TS)      ← transform.ts (export) consomme
docs/schema/<name>/v1/types.ts      ← devient un ré-export des types générés (ou supprimé)
editor/src/domain/types.ts          ← RESTE à la main (projection d'édition : LText, step-trees, canvasLayout)
```

- **schema.json** est écrit/réécrit pour matcher la **forme canonique choisie** (cf. ci-dessous), pas la forme périmée actuelle.
- **quicktype** génère, à partir de chaque `schema.json`, les `sealed class` Kotlin et les types TS. Un script de build (`bun run schema:gen` ou équivalent) regénère ; la CI échoue si le généré diffère du commité.
- **Le domain de l'éditeur** projette vers/depuis le canonique via `transform.ts` (export, existant) et le futur convertisseur d'import (feature IA / import de fichiers). Il garde i18n (`LText`+catalogue) et `canvasLayout` comme sidecars.

## Forme canonique (les choix « propres »)

À appliquer dans chaque `schema.json`, puis répercuter sur export éditeur + parseur plugin :

- **Conditions** : une union discriminée par `type`. `of` **partout** (`not`/`and`/`or` → `of`), on **abandonne `all`/`any`**. `if` est **toujours** un tableau `Condition[]` (on retire le collapsing map). Vocabulaire = **ensemble canonique réconcilié** (cf. workstream ci-dessous).
- **Actions** : une union discriminée, snake_case, vocabulaire canonique réconcilié.
- **Steps (clics)** : on **garde** `{ kind: "action", action } | { kind: "if", cases[], else? }`. Les branches restent dans le contrat.
- **Title** : **toujours** un tableau de `MenuTitleLayer` (on retire le raccourci string legacy au niveau canonique ; layer `plain` pour le mode vanilla).
- **Menu** : `size` (9/18/27/36/45/54) canonique (pas `rows`) ; `context_inputs` (snake_case) dans le schéma.
- **i18n** : tout champ texte est une `string` qui peut être un **littéral** (MiniMessage + `%papi%`) **ou** une réf inline `{i18n:key}`. Les traductions vivent dans `translations/v1` (fichiers `lang/<lang>.yaml`, map plate `key: value`).

## Workstream « réconciliation des vocabulaires »

Cœur du projet : il faut **un seul** ensemble par catégorie, et faire converger les trois sources. Principe : le canonique = **superset réconcilié**, l'éditeur et le plugin s'y conforment, les écarts non-implémentés sont des TODO documentés (pas supprimés du schéma s'ils sont des constructs réels).

Points de réconciliation connus à trancher pendant l'implémentation (chacun = une décision explicite dans le plan, pas un défaut silencieux) :

- **`expression` (condition DSL)** : présent dans le domain éditeur, absent du plugin et de `docs/schema`. Décider : (a) l'inclure au canonique + le plugin doit le parser (au moins le désérialiser), ou (b) le marquer éditeur-only / déprécié. **Recommandation : l'inclure** (c'est un construct réel), le plugin le désérialise ; l'évaluation runtime du DSL = gap documenté si pas déjà fait.
- **Actions** : réconcilier domain (`set_arg`, `set_arg_cycle_*`, `paginate`, `open_dialog`, `close_dialog`, `show_title`, …) ⨯ plugin (`pagination_next/prev`, `broadcast`, `play_sound`, `teleport`, `give/take_item`, `give_xp/level`, …) ⨯ docs (15). Établir la liste canonique unique + alias éventuels (ex. `paginate{direction}` vs `pagination_next/prev`).
- **Conditions** : domain (8 + `expression`) ⨯ plugin (17) ⨯ docs (17). Canonique = l'ensemble réconcilié.

Chaque réconciliation produit : entrée dans `schema.json`, type généré, conformité export éditeur, conformité parseur plugin, et une ligne CHANGELOG.

## Conformité par couche

- **Éditeur** (`transform.ts` + appels) :
  - conditions : `all`/`any` → `of`, retirer le collapsing (toujours tableau) ;
  - title : toujours tableau (retirer le raccourci string plain-only) ;
  - aligner le vocabulaire d'actions/conditions sur le canonique ;
  - importer les **types TS générés** au lieu de `docs/schema/.../types.ts` à la main.
- **Plugin** (`engine/`, `model/`) :
  - remplacer les data classes Jackson à la main par les `sealed class` **générées** ;
  - `ConditionParser` : `all`/`any` → `of` ;
  - le title parser est déjà tolérant (string + array) — garder la tolérance en lecture, le canonique en écriture.
- **`docs/schema`** : `schema.json` réécrits canoniques ; `types.ts` → ré-export du généré ; exemples mis à jour et validés.

## Pipeline codegen + CI

- **Script de génération** : `quicktype` invoqué par schéma → écrit les types générés dans le plugin et l'éditeur. Exposé via une commande (`bun run schema:gen`).
- **CI (anti-dérive)** :
  1. **codegen drift** : regen + `git diff --exit-code` sur les fichiers générés.
  2. **ajv** : valider (a) l'export de l'éditeur d'un pack « golden » contre `schema.json`, (b) les fixtures de test du plugin, (c) les fichiers `examples/`.
  3. tests existants éditeur/plugin/backend continuent de passer.

## Phasage

- **P1 — menu/v1** : schema.json canonique + quicktype (Kotlin+TS) + conformité export éditeur & parseur plugin + CI (drift + ajv menus). Réconcilier conditions/actions/steps/title pour les menus. **→ débloque la feature IA et le test des menus prod.**
- **P2 — autres schémas** : `command/v1`, `dialog/v1`, `translations/v1`, `manifest`/`pack/v1`, `template/v1` — même patron (schema → codegen → conformité → CI).
- **P3 — durcissement** : CI drift-check sur tous les générés, retrait des raccourcis legacy (title string, `if` collapsé, `all`/`any`) une fois toutes les couches migrées, doc d'architecture mise à jour.

## Gaps runtime documentés (hors-scope, à tracer)

- Plugin : exécution des **branches `if`** dans les clics (aujourd'hui ignorées).
- Plugin : **`context_inputs` / itération / data-sources** (désérialisés via types générés, pas exécutés).
- Plugin : évaluation du DSL `expression` si non implémentée.

Ces gaps sont **inscrits dans le schéma** (constructs réels) et **listés comme TODO** dans `docs/architecture/` + `CHANGELOG`, chacun candidat à un projet feature séparé.

## Tests

| Couche | Couverture |
|---|---|
| Codegen | `bun run schema:gen` est idempotent ; CI drift (regen + diff) rouge si désync. |
| ajv | export éditeur d'un pack golden valide contre `menu/v1/schema.json` (P1), puis chaque schéma (P2) ; exemples valident ; fixtures plugin valident. |
| Éditeur | `transform.test.ts` mis à jour pour la forme canonique (conditions `of`/tableau, title toujours array) ; round-trip export→ajv. |
| Plugin | tests de parsing existants migrés sur les types générés ; un menu canonique se parse ; rétro-compat lecture (string title, etc.) conservée le temps de la transition. |
| Réconciliation | pour chaque action/condition canonique : un exemple qui sérialise (éditeur) et parse (plugin) sans perte. |

## Docs à mettre à jour

- `docs/architecture/` : nouvelle doc « schémas canoniques & codegen » (source de vérité, pipeline quicktype, CI, gaps runtime).
- `docs/schema/*/v1/README.md` : refléter la forme canonique + le fait que `types.ts` est généré.
- `CHANGELOG.md` `[Unreleased]` : chaque changement de schéma / vocabulaire.
- `CLAUDE.md` : commande `schema:gen`, règle « modifier un schéma = regen + CI », mapping doc-impact.
- `docs/architecture/versioning.md` : rappeler la discipline « nouveau breaking = `/v2`, pas de mutation d'un `/v1` shipé » à la lumière de la source unique.

## Relation avec la feature IA

Après **P1**, mettre à jour `2026-06-08-ai-assistant-design.md` :
- le contrat émis par l'IA = `menu/v1` **canonique** ;
- le gate = `ajv(menu/v1/schema.json)` + les checks cross-field (`validateMenuLayout` aligné sur le canonique) ;
- le convertisseur `menu/v1 → domain` se réduit au **pont i18n** + projection (canvas/rows), puisque la forme canonique et le domain sont alignés structurellement.

## Risques / limites

- **quicktype + oneOf/discriminant** : la qualité des `sealed class` Kotlin générées dépend de discriminants `type`/`kind` propres dans `schema.json` — écrire les schémas avec des `oneOf` discriminés explicites. Vérifier la sortie Kotlin sur les unions dès la P1 (spike).
- **Réconciliation des vocabulaires** : c'est le vrai travail de design ; chaque écart est une micro-décision (inclure / aliaser / déprécier). Le plan doit les énumérer, pas les masquer.
- **Churn plugin** : remplacer les data classes Jackson à la main par du généré peut toucher beaucoup de fichiers — d'où le phasage menu-first.
