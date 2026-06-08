# Codegen des schémas (quicktype)

Source de vérité : `docs/schema/<name>/v1/schema.json`.

Commande Kotlin (plugin) :
`npx quicktype --src <schema.json> --src-lang schema --lang kotlin --framework jackson --package <pkg> -o <out.kt>`

Commande TS (éditeur) :
`npx quicktype --src <schema.json> --src-lang schema --lang typescript --just-types --prefer-unions --prefer-const-values -o <out.ts>`

Verdict spike 2026-06-08 : **NO-GO** — quicktype 23.2.6 (Node 25) ne produit pas de hiérarchie de types exploitable pour nos unions discriminées par `const`. Deux problèmes bloquants. (1) Crash dur : un `"const": true` booléen (`ComponentClick.use_component_default`) fait planter quicktype avec `Error: s.codePointAt is not a function` — quicktype suppose que toute valeur `const` est une string. Aucun output n'est généré tant que ce const booléen existe dans le schéma. (2) Même après avoir contourné le crash (en remplaçant le const booléen par `"enum": [true]` dans une copie throwaway du schéma), les `oneOf` discriminés par `const` (`Condition`, `Action`) ne deviennent **pas** des `sealed class` Kotlin ni des unions discriminées TS : quicktype aplatit les 16 variantes de `Condition` (et les 15 de `Action`) en **une seule `data class`/`interface` god-object** avec ~20-25 champs tous nullables, plus un `enum`/union de strings pour le discriminant `type`. Aucune sous-classe typée (`HasPermission`, `OpenMenu`…), aucune annotation Jackson `@JsonTypeInfo`/`@JsonSubTypes` émise, et le merge produit même des artefacts cassés (`amount?: number | number`, `of?: Cond[] | Cond` fusionnant `not`/`and`/`or`). C'est exactement le `Map<String, Any?>`-équivalent que les critères d'acceptation rejettent. Note : quicktype émet bien des `sealed class` pour les unions *scalaires/de forme* (`Amount` = Double|Long, `RangeUnion` = string-enum|object), donc le générateur sait faire des sealed classes — il ne le fait simplement pas pour les unions discriminées par `const`, qui sont précisément notre cas dur.

## Fallback retenu (NO-GO)

Types **écrits à la main** côté Kotlin et TS, modélisant `Condition`/`Action` comme de vraies hiérarchies :
- Kotlin : `sealed class Condition` / `sealed class Action` avec une sous-classe `data class` par variante (`HasPermission(perm)`, `OpenMenu(menuId, …)`, …), désérialisation polymorphe Jackson via `@JsonTypeInfo(use = NAME, property = "type")` + `@JsonSubTypes`. Package `net.artisanmc.plugin.schema.menu`.
- TS : `type Condition = HasPermission | HasMoney | …` (union discriminée par `type` littéral), une interface par variante.

Le schéma JSON reste la **source de vérité**. La cohérence types ↔ schéma est garantie non par codegen mais par un **drift check CI** : un jeu de fixtures (un exemple valide minimal + un exemple riche par variante de `Condition`/`Action`, plus quelques menus complets) est validé contre `schema.json` via **ajv** (draft 2020-12). Tout champ ajouté/retiré/renommé dans les types à la main qui s'écarte du schéma est attrapé soit par la compilation (les fixtures sont aussi parsées dans les types), soit par ajv. Concrètement :
1. `docs/schema/menu/v1/schema.json` = vérité.
2. Fixtures `docs/schema/menu/v1/examples/*.json` (1 par variante d'union au minimum).
3. CI : ajv-validate toutes les fixtures contre le schéma + parse-les dans les types Kotlin (test plugin) et TS (test éditeur). Échec si divergence.

Re-spike quicktype recommandé seulement si : (a) un correctif upstream du crash `const` booléen ressort **et** (b) une option fiable de génération de sealed-class par `oneOf`+`const` apparaît. À défaut, rester sur types manuels + drift check.
