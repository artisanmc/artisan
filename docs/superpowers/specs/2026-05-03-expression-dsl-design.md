# Expression DSL — Design Spec

**Date** : 2026-05-03
**Statut** : Design validé, **partiellement dépassé** — cf. ADR `expression-parity`
(2026-08-05). Deux points de ce document ne décrivent plus la cible :
- « pas de méthodes string » / grammaire strictement fermée → l'implémentation
  éditeur a adopté un **vocabulaire fermé de méthodes** (`join`, `pluck`,
  `length`, `first`, `last`, `at`, `contains`), et c'est la forme retenue.
- Le document ne dit rien du **runtime** : le serveur n'implémente rien de cette
  grammaire (`ArgResolver`, regex `{name}`/`{alias.field}`). La parité TS ↔ Kotlin
  est désormais un contrat verrouillé par vecteur de conformance.

Le reste (grammaire, coercions, philosophie tolérante, i18n imbriquée) reste la
référence.
**Auteur** : iban (brainstorming session avec Claude)

## Résumé

Ajout d'un mini-DSL d'expressions à grammaire fermée, syntaxe JS-like, embarqué dans les champs Template existants (lore, title, command, etc.) et dans deux nouveaux types de champs typés Expression. Permet :

- Joindre une liste avec un séparateur (`{quest.tags.join(", ")}`)
- Conditionnels inline (`{quest.gold > 1000 ? "<gold>" : "<gray>"}`)
- Conditions complexes (`{ type: "expression", expr: "..." }`)
- Mutation in-place du contexte (`set_arg`, `set_arg_cycle_next/prev`)

Le DSL est volontairement minimal et fermé : pas de fonctions admin, pas de variables locales, pas de méthodes string. Power et simplicité d'éditeur passent avant flexibilité maximale.

## Motivation

Le schéma actuel (`web/src/domain/types.ts`) supporte déjà des placeholders simples (`{name}`, `{alias.field}`, `%papi%`, `{i18n:key}`) dans les champs texte. Mais on ne peut pas :

1. **Itérer / formater une liste** dans une seule string → forcé de créer plusieurs Appearances dupliquées
2. **Choisir un mot selon une condition** sans dupliquer toute l'Appearance
3. **Évaluer une condition complexe** au-delà d'un simple `placeholder_equals`
4. **Calculer une valeur d'argument** dynamiquement (cycler une catégorie, etc.)

Use-case déclencheur : un shop avec catégories cyclables où la liste de catégories vient d'un connecteur (donc inconnue à l'édition). Sans cycle dynamique, impossible.

## Décisions de design (résumé)

- **Grammaire fermée**, syntaxe JS-like (pas de vrai JS engine — implémentation custom Java).
- **Deux types de champ** : Template (texte mixé) et Expression (la string EST une expression).
- **Identifiants context-aware** : `{name}`, `{alias.field}`, `index/count/first/last`, `%papi%`. Anchored sur `Menu.contextInputs` et `Element.iterates`.
- **i18n imbriquée autorisée** : `{i18n:literalKey}` recursif avec cycle detection et profondeur max 5.
- **Arithmétique limitée** : `+` et `-` (pas de `*`, `/`, `%` — `%` conflit avec PAPI delimiter).
- **Pas de fonctions free** dans la grammaire V1 : les use-cases (cycle) sont couverts par des actions déclaratives dédiées.
- **Éditeur form-only** pour V1 sur Expression fields (mode "code raw" différé V1.5+).
- **Runtime tolérant** : aucune erreur d'expression ne crash un menu. Insertion de `⚠️ <msg>` ou retour `null` selon contexte.

## 1. Grammaire

### 1.1 EBNF

```ebnf
expression  = ternary
ternary     = orExpr ( "?" ternary ":" ternary )?
orExpr      = andExpr ( "||" andExpr )*
andExpr     = notExpr ( "&&" notExpr )*
notExpr     = "!" notExpr | compareExpr
compareExpr = addExpr ( ( "==" | "!=" | "<" | "<=" | ">" | ">=" ) addExpr )?
addExpr     = primary ( ( "+" | "-" ) primary )*
primary     = literal
            | papiPlaceholder
            | path
            | "(" expression ")"

path        = identifier ( "." identifier | "[" expression "]" | methodCall )*
methodCall  = "." identifier "(" ( expression ( "," expression )* )? ")"

literal           = stringLit | numberLit | "true" | "false" | "null"
stringLit         = '"' ( [^"\\] | "\\" anyChar )* '"'
                  | "'" ( [^'\\] | "\\" anyChar )* "'"
numberLit         = [0-9]+ ( "." [0-9]+ )?
papiPlaceholder   = "%" [a-z_] [a-z0-9_]* "%"
identifier        = [a-zA-Z_] [a-zA-Z0-9_]*
```

### 1.2 Identifiants disponibles dans le scope

| Token | Origine | Type | Disponible quand |
|---|---|---|---|
| `<inputName>` | `Menu.contextInputs[name]` | typé selon `ContextInput.type` | Toujours |
| `<alias>` | `Element.iterates.alias` (objet item courant) | object | Element itératif |
| `<alias>.<field>` | champ de l'item courant | typé selon connecteur | Element itératif |
| `index` | index 0-based dans l'itération | number | Element itératif |
| `count` | nombre total d'items | number | Element itératif |
| `first` | `index == 0` | bool | Element itératif |
| `last` | `index == count - 1` | bool | Element itératif |
| `%any_papi_placeholder%` | n'importe quel placeholder PAPI | string (auto-coerce) | Toujours |

Hors itération, accéder à `index`/`count`/`first`/`last` → erreur de validation à l'édition, retour `null` au runtime.

### 1.3 Méthodes liste

Sur une valeur de type `list` (incluant `quest.tags` etc.) :

| Méthode | Retour | Notes |
|---|---|---|
| `.join(separator)` | string | Concat avec séparateur. `[]` → `""` |
| `.length` | number | Property, pas de parens. `null` → `0` |
| `.first` | element | Property. `[]` → `null` |
| `.last` | element | Property. `[]` → `null` |
| `.at(n)` | element | Out-of-bounds → `null` |
| `.contains(x)` | bool | Égalité stricte (string ou number selon type) |

Aucune méthode sur string (intentionnel — V1 minimal).

### 1.4 Opérateurs et coercion

**Comparaison** (`==`, `!=`, `<`, `<=`, `>`, `>=`) :
- Si les deux côtés parsent en `Number` (Java `Double.parseDouble`) → compare numérique
- Sinon → string compare lexicographique
- `null == ""` est **true** (équivalence "valeur absente")
- `null == 0` est **false**

**Booléens** (`&&`, `||`, `!`, ternaire) :
- Falsy : `null`, `""`, `0`, `false`
- Truthy : tout le reste, **incluant la liste vide `[]`** (style JS)
- Court-circuit standard pour `&&` et `||`

**Arithmétique** (`+`, `-`) :
- `Number + Number` → `Number`
- `String + anything` → string concatenation (style JS)
- `Number - Number` → `Number`
- `String - anything` → erreur d'eval (warning, retourne `null`)

**Accès safe** :
- `quest.gold` quand `quest` est `null` → `null`
- `quest.tags.length` quand `quest.tags` est `null` → `0`
- `quest.tags.join(",")` quand `quest.tags` est `null` → `""`
- `arr[5]` out-of-bounds → `null`

### 1.5 Volontairement hors grammaire V1

- `*`, `/`, `%` (modulo entrerait en conflit avec PAPI delimiter)
- Méthodes string (`.toUpperCase`, `.substring`, etc.)
- Fonctions free (`cycleNext`, `i18n(key)`, etc.) — **les use-cases qui en auraient eu besoin sont remplacés par des actions déclaratives dédiées** (`set_arg_cycle_next/prev`)
- Variables locales, fonctions admin
- Méthodes mutantes (`.push`, `.set`, etc.)

Tout ça peut être ajouté plus tard, **purement additivement**.

## 2. Modifications schéma

### 2.1 Nouveau type de condition

Ajout dans `web/src/domain/types.ts` :

```typescript
export type Condition =
  | { type: "has_permission"; perm: string }
  | { type: "has_money"; amount: number }
  | { type: "placeholder_equals"; placeholder: string; value: string }
  | { type: "placeholder_match"; placeholder: string; regex: string }
  | { type: "not"; of: Condition }
  | { type: "and"; of: Condition[] }
  | { type: "or"; of: Condition[] }
  | { type: "expression"; expr: string };  // NEW
```

`expr` est une string contenant une expression du DSL. Coercée à boolean via les règles falsy/truthy à l'eval.

### 2.2 Nouvelles actions

```typescript
export type Action =
  | { type: "open_menu"; menuId: MenuId; clearContext?: boolean; context?: Record<string, string> }
  | { type: "close_menu" }
  | { type: "run_command"; command: string; as: "player" | "console" }
  | { type: "send_message"; text: LText }
  | { type: "give_item"; material: string; count: number }
  | { type: "take_money"; amount: number }
  | { type: "paginate"; direction: "next" | "prev"; targetElementId?: ElementId }
  // NEW
  | { type: "set_arg"; arg: string; value: string }
  | { type: "set_arg_cycle_next"; arg: string; list: string }
  | { type: "set_arg_cycle_prev"; arg: string; list: string };
```

- `set_arg` : mute le `contextInput[arg]` du menu courant à l'évaluation de `value` (Expression). Trigger re-render du menu courant.
- `set_arg_cycle_next/prev` : évalue `list` (Expression retournant une liste), trouve l'index courant via égalité avec la valeur courante de `contextInput[arg]`, set à l'item suivant/précédent (wrap-around). Si pas d'item courant ou liste vide → premier/dernier ou `null`. Trigger re-render.

**Contraintes sur `arg`** :
- Doit correspondre au `name` d'un `Menu.contextInputs[*]` existant. Validation à l'édition (dropdown limité aux inputs déclarés). Si un runtime voit un `arg` inconnu (pack mal formé, input renommé sans propagation), no-op + warn log.
- Inputs avec `source: ConnectorBinding` ne peuvent pas être mutés par `set_arg*` (ils sont fetch live). Validation à l'édition refuse de proposer ces inputs dans le dropdown.

### 2.3 Convention Template vs Expression sur les champs string

Pas de branded types ; convention documentée champ par champ.

| Champ | Type sémantique | Notes |
|---|---|---|
| `LText` (translation values) | Template | i18n + MM + PAPI + `{expr}` |
| `RunCommandAction.command` | Template | mêmes règles |
| `OpenMenuAction.context` values | Template | mêmes règles |
| `placeholder_equals.placeholder` / `.value` | Template (rétrocompat) | était déjà template, reste template |
| `placeholder_match.placeholder` / `.regex` | Template / regex | placeholder template, regex literal |
| `expression.expr` | Expression | la string entière EST une expression |
| `set_arg.value` | Expression | idem |
| `set_arg_cycle_*.list` | Expression (retour list) | idem |

### 2.4 Pas de migration

Les anciens templates `{name}` continuent de marcher : un identifier seul EST une expression valide. Aucun changement requis sur les packs existants.

## 3. Sémantique d'évaluation

### 3.1 Pipeline render Template

Pour chaque champ Template au render :

1. **(LText only)** Lookup `pack.i18nKeys[key][activeLang || defaultLang]` → string template. Missing → fall-back à `defaultLang`, puis `""` (silencieux).
2. **Pré-pass i18n imbriquée** : remplace récursivement `{i18n:literalKey}` par sa traduction.
   - Visiting set pour cycle detection
   - Profondeur max 5 → au-delà, insère `⚠️ i18n depth exceeded`
   - Cycle → insère `⚠️ i18n cycle: a→b→a`
3. **Tokenize** template : segments littéraux (texte, MM tags, `%PAPI%` extérieurs) vs segments expression `{...}`.
   - Matching `{...}` gère l'imbrication des parens dans les méthodes (`{quest.tags.join(", ")}` est UN seul segment)
4. **Eval chaque expression** : parse → AST (cache) → eval avec scope courant → string (toString sur non-strings).
   - Erreur d'eval → insère `⚠️ <msg>` et continue (pas de crash menu)
5. **Concat** segments.
6. **Résolution PAPI** : remplace les `%foo%` restants (ceux des littéraux ET ceux re-émis depuis un eval).
7. **MiniMessage parse** → Component Adventure.
8. **Send** au joueur.

**Note** : `%foo%` à l'intérieur d'une expression (étape 4) est lu directement par l'évaluateur (token `papiPlaceholder`). À l'extérieur (étape 6), résolu en bout de chaîne. Conséquence : un `%vault_eco_balance%` dans une compare `> 1000` est lu numériquement au moment de la compare.

### 3.2 Pipeline Expression standalone

Pour les champs Expression (`expression.expr`, `set_arg.value`, `set_arg_cycle.list`) :

1. **Parse → AST** (cache).
2. **Eval** avec scope.
3. **Coerce** au type attendu :
   - `expression.expr` → boolean (falsy/truthy)
   - `set_arg.value` → string (toString)
   - `set_arg_cycle.list` → list (sinon eval error → action no-op + warn log)
4. **Sur erreur** : valeur safe par défaut (false / "" / no-op), warning loggé côté plugin.

**Expression vide** (`""` ou whitespace) : retourne `null`. Pour `expression.expr` → coerce à `false` (condition jamais vraie). Pour `set_arg.value` → coerce à `""`. Pour `set_arg_cycle.list` → no-op + warn (pas de liste).

### 3.3 Validation côté éditeur (3 couches)

1. **Parse-time** (à chaque keystroke) : syntaxe valide. Erreurs surlignées rouge inline.
2. **Type-check** (sur sauvegarde du field) : identifiants existent dans le scope, méthodes valides pour le type. Warnings non bloquants → panel "Issues".
3. **Publish-time** : tous les warnings type-check doivent être résolus, sinon publish bloqué. Cycle i18n statique détecté → bloque aussi.

### 3.4 Erreurs runtime — philosophie

Le runtime est **silencieux et tolérant** :
- Expression invalide → `""` inséré + log WARN
- Reference invalide → `null` → coerce à `""`
- Cycle i18n → marker visible `⚠️` (debug-friendly)

Le runtime ne crash JAMAIS un menu pour une erreur d'expression. La responsabilité d'attraper les bugs vit dans la validation publish.

## 4. Éditeur UX

### 4.1 Deux modes d'éditeur de field

**Template field** (LText, plain template strings) — composant `<TemplateEditor>`, étend l'éditeur MM existant (`web/src/features/canvas/TextEditor.tsx`) avec :

- Toolbar étendue : `[B][I][U][color]` + `[{i18n}]` + `[+ Placeholder]` + `[? Si...]` + `[⨁ Liste→texte]` + `[📚 Patterns]`
- Textarea avec syntax highlighting léger (MM gris, expressions bleu, PAPI violet, i18n jaune, erreurs rouge sous-ligne)
- Live preview pane à droite (ou bottom-sheet sur mobile)

**Expression field** (set_arg.value, expression.expr, set_arg_cycle.list) — composant `<ExpressionEditor>`, **form uniquement V1**. Pas de mode raw text V1 (différé V1.5).

### 4.2 Toolbar buttons des Template fields

| Bouton | Comportement | Génère |
|---|---|---|
| `+ Placeholder` | Popover : sections "Inputs du menu", "Iteration courante", "PAPI search" | `{quest.name}` |
| `? Si...alors...sinon...` | Modale form : condition (Expression form) + alors (Template) + sinon (Template) | `{cond ? "alors" : "sinon"}` |
| `⨁ Liste → texte` | Modale form : choix liste + séparateur (préréglé virgule/newline/puce/custom) | `{quest.tags.join(", ")}` |
| `📚 Patterns` | Modale gallery (15 entrées V1) | varies |
| `{i18n}` | Existant, inchangé | `{i18n:key}` |

### 4.3 Autocomplete inline (Template fields)

Déclencheurs :
- `{` → identifiants disponibles dans le scope + `{i18n:` literal trigger
- `.` après identifier → méthodes valides pour le type (sur list : `.join`, `.length`, `.first`, `.last`, `.at`, `.contains` ; sur autre : silence)
- `%` → recherche PAPI

**Scoping intelligent** : helper `inferScope(packPath)` retourne identifiants visibles + types. Réutilisable lint et autocomplete. Si l'Element n'itère pas, `index/count/first/last` n'apparaissent pas.

**Suggestions** : nom + type + description courte + exemple.

### 4.4 Live preview + sample context

Utilise `Menu.sampleContext` actuel. Update live (debounced 100ms). Erreurs visibles inline avec messages plain language.

**Multi-iteration preview** : si Element itère, montre 3 instances côte-à-côte (premier / milieu / dernier) pour visualiser `first`/`last`/`index`.

### 4.5 Patterns gallery V1 (15 entrées)

| # | Titre | Génère |
|---|---|---|
| 1 | Afficher un placeholder | `{quest.name}` |
| 2 | Couleur conditionnelle selon montant | `{quest.gold > 1000 ? "<gold>" : "<gray>"}` |
| 3 | Texte conditionnel selon perm | `{%player_has_permission_vip% == "true" ? "VIP" : ""}` |
| 4 | Joindre liste avec virgules | `{quest.tags.join(", ")}` |
| 5 | Joindre liste sur lignes | `{quest.tags.join("\n")}` |
| 6 | Page X sur N | `Page {index + 1} sur {count}` |
| 7 | Étoile sur premier élément | `{first ? "★ " : ""}{quest.name}` |
| 8 | Texte verrouillé si pas perm | `{%player_has_permission_shop_vip% == "true" ? "" : "<dark_gray>(VIP requis)</dark_gray>"}` |
| 9 | Comparer solde à un prix | `{%vault_eco_balance% >= quest.gold ? "<green>Acheter" : "<red>Trop cher"}` |
| 10 | Préfixe selon rareté | `{quest.rarity == "legendary" ? "<gold>★ " : ""}{quest.name}` |
| 11 | Compter items dans liste | `{quest.tags.length} catégories` |
| 12 | Premier ou défaut | `{quest.tags.first}` |
| 13 | Cycler une catégorie au clic | (action `set_arg_cycle_next`) |
| 14 | Reset une catégorie | (action `set_arg`) |
| 15 | Réutiliser un terme i18n | `{i18n:common.coins}` |

**Note PAPI** : entrées 3 et 8 utilisent `%player_has_permission_<perm>%` qui est un pattern PlaceholderAPI standard ("true"/"false" en string). Entrée 9 utilise `%vault_eco_balance%` (extension Vault de PAPI). À adapter selon les plugins effectivement présents sur le serveur cible.

### 4.6 Conditions UI — `expression` cachée derrière "Avancé"

Picker d'ajout de condition :
- A la permission
- A assez d'argent
- Comparer une valeur (form structuré : côté gauche / opérateur / côté droite + ET/OU)
- ──────────
- Avancé : expression libre → ouvre `<ExpressionEditor>` form-only

L'éditeur préserve l'identité : si l'admin a créé via "Comparer une valeur", on stocke en `placeholder_equals` quand possible (égalité simple), sinon en `expression` (autres opérateurs).

### 4.7 Action picker — nouvelles entrées

Groupe "Contexte" dans le picker d'actions :
- Définir une valeur de contexte → `set_arg` (form : arg dropdown + value Expression form)
- Cycler vers la valeur suivante d'une liste → `set_arg_cycle_next` (form : arg dropdown + list dropdown ou Expression)
- Cycler vers la valeur précédente → `set_arg_cycle_prev` (idem)

### 4.8 Messages d'erreur — plain language

Mapping technique → admin :

| Technique | Admin |
|---|---|
| `Unknown identifier 'categry'` | `⚠️ "categry" n'existe pas ici. Tu voulais "category" ? Disponibles : category, player, quests` |
| `Cannot call .join on type number` | `⚠️ "quest.gold" est un nombre, pas une liste. .join uniquement sur listes (comme quest.tags).` |
| `Parse error at col 17: expected ')'` | `⚠️ Parenthèse fermante manquante près de "...quest.gold > 1000".` |
| `i18n cycle: a→b→a` | `⚠️ Cycle de traduction : la clé "a" se réfère à "b" qui se réfère à "a". Casse l'une des deux.` |
| `i18n depth exceeded` | `⚠️ Trop de traductions imbriquées (max 5). Aplatis la chaîne.` |

Affichés inline sous le field + dans un panel "Issues" central.

### 4.9 Adaptation mobile

Mémoire pertinente : `<lg = mobile single-pane + drawers`, pas de hover-only.

- Toolbar Template : devient un bouton unique `+` qui ouvre une bottom-sheet avec toutes les actions
- Live preview : toggle "👁 Preview" → bottom-sheet
- Autocomplete : popover → bottom-sheet
- Sample context editor : drawer dédié

### 4.10 Form-only sur Expression fields (V1)

Pas de mode "code raw" V1. Les Expression fields sont construits via form structuré qui couvre :
- Comparison binaire (côté gauche / op / côté droite)
- Composition ET/OU avec parenthèses
- Ternaire (si / alors / sinon) — réutilise le bouton "? Si..." du toolbar Template
- Method calls (`.length`, `.first`, `.contains(x)`) après sélection d'identifier list

Pour V1.5+, ajout d'un toggle "⚙ Code" qui expose le textfield brut avec autocomplete (pour power users).

## 5. Runtime Java

### 5.1 Module `expr/`

```
plugin/src/main/java/net/artisanmc/expr/
├── lexer/Lexer.java
├── parser/Parser.java
├── parser/ParseError.java
├── ast/{Node, Literal, Identifier, PathAccess, MethodCall, BinaryOp, UnaryOp, Ternary, PapiToken, IndexAccess}.java
├── eval/{Evaluator, Scope, Coercion, EvalError}.java
├── cache/AstCache.java
└── template/{TemplateRenderer, I18nResolver, TemplateTokenizer}.java
```

Aucune dépendance Bukkit/Paper dans le code DSL pur. Seules les fonctions d'intégration accèdent à PAPI / context.

### 5.2 Implémentation

- **Lexer** : tokenize string → `List<Token>`. Position-aware. ~250 LOC.
- **Parser** : recursive-descent. Une fonction par règle EBNF. ~400 LOC.
- **Évaluateur** : visitor. `evaluate(Node, Scope) → Object` (`null|String|Double|Boolean|List<Object>|Map<String,Object>`). Coercion centralisée. ~350 LOC.
- **AstCache** : Caffeine LRU 5000 entrées. Key = `(expressionString, packId, packVersion)`. ~50 LOC.
- **TemplateRenderer** : orchestre les 8 étapes du pipeline. ~250 LOC.
- **I18nResolver** : recursive resolve avec visiting set + depth limit. ~80 LOC.
- **Tests Java** : ~600 LOC (cf. 6).

**Total Java** : ~2060 LOC + 600 tests.

### 5.3 Threading

Tout sur main thread (Bukkit) pour V1. PAPI doit être appelé sur main thread. Pas de concurrent maps, pas de locks. Si plus tard un connecteur lourd doit aller en async, on cap-fetch async puis re-render sur main.

### 5.4 Points d'intégration plugin

| Hook | Quand | Quoi appeler |
|---|---|---|
| Menu open | Joueur ouvre | `render` sur title + appearances visibles |
| Click handler | Joueur click | `evaluate` sur conditions, dispatch action |
| `set_arg` action | Pendant click | `evaluate(value)`, mute `MenuSession.context`, redraw |
| `set_arg_cycle_*` action | Idem | Évalue list, find current, set to next/prev wrap, redraw |
| `expression` condition | Pendant evaluate Conditions | `evaluate(expr)` → `toBoolean` |

`MenuSession` (par joueur, mémoire) : stocke `Map<String, Object> context` muté par `set_arg*`. À la fermeture, dropped. Pas de persistance.

### 5.5 Performance — cibles à valider

Cibles à benchmarker (estimations, à mesurer empiriquement sur Paper 1.21 + JRE 21) :

| Op | Cible |
|---|---|
| Parse expression cold | ≤ 50 µs |
| Eval expression cached | ≤ 5 µs |
| Render Template complet | ≤ 200 µs |
| Menu open total (54 slots) | ≤ 30 ms |

Validation par benchmarks JMH (cf. 6.3).

### 5.6 Côté éditeur (TS)

Mirror du parser+évaluateur en TS pour live preview et autocomplete :

```
web/src/lib/expr/
├── lexer.ts
├── parser.ts
├── ast.ts
├── evaluator.ts (operates sur sample data)
├── coercion.ts
├── scope.ts (inferScope par packPath)
└── autocomplete.ts
```

~1650 LOC + 400 tests.

**Équivalence Java/TS** garantie par fixture file partagé `expr-fixtures.json` : ~100 expressions de référence avec input + expected output, exécuté par les deux suites de tests.

## 6. Plan de tests

### 6.1 Tests unitaires Java (JUnit 5)

| Module | Couverture |
|---|---|
| Lexer | Chaque token, edge cases (`%foo_bar%`, escaped quotes, decimals) |
| Parser | Chaque règle EBNF, erreurs de syntaxe, précédence opérateurs, associativité ternaire |
| Evaluator | Chaque Node type, coercion matrix exhaustive, accès safe (null path), méthodes, arithmétique edge cases |
| AstCache | Hit/miss, eviction LRU, invalidation sur version |
| TemplateRenderer | Pipeline complet, i18n cycle, depth limit, PAPI mock, tokenize edge cases (curly braces dans strings) |
| I18nResolver | Cycle detection, depth limit, missing key fallback |

### 6.2 Tests d'intégration Paper

**Setup à créer** (n'existe pas encore dans le repo) : container Docker Paper 1.21 + EssentialsX, fixtures de menus de test.

Scénarios :
- Menu réel ouvert avec context input + connecteur, vérif rendu
- Click action `set_arg_cycle_next` → vérif valeur context mutée + menu redrawn
- Condition `expression` avec PAPI → vérif évaluation correcte
- i18n imbriqué multi-langue → vérif fallback chain

### 6.3 Benchmarks JMH

Module séparé `expr-bench` :
- Parse cold vs warm cache
- Eval simple (`a == b`) vs complex (méthodes + ternaire imbriqué)
- TemplateRenderer end-to-end (avec PAPI mock)

Cible : pas de régression > 10% entre versions.

### 6.4 Tests TS éditeur (Vitest)

- Parser TS mirror : équivalence avec Java sur fixtures partagées
- Autocomplete : déclencheurs `{`, `.`, scope inference
- Form-to-expression generator : chaque pattern de la gallery génère la bonne string
- Lint : mauvais identifier → bonne suggestion plain language

### 6.5 Tests E2E (Playwright)

Sur l'éditeur web :
- Insère un placeholder via toolbar → vérif texte généré
- Construit un conditional via form → vérif texte généré
- Pattern gallery → click → insère le pattern dans le field
- Live preview update à chaque keystroke
- Erreur visible inline sur identifier inconnu

## 7. Migration

Pas de migration de packs existants requise : la grammaire est rétrocompatible. `{name}` simple est une expression valide. Les anciens packs n'utilisent simplement pas les nouvelles features tant que l'admin ne les édite pas.

Côté plugin : pas de feature flag — la fonctionnalité est dans le moteur dès la version qui l'embarque.

Côté éditeur : validation au publish empêche d'utiliser les nouvelles features sur un pack ciblant un plugin trop ancien (warning visible avant push to live).

## 8. Hors scope V1

Capturé pour spec(s) ultérieure(s) :

- **Mode "Code raw"** sur Expression fields → V1.5+
- **Fonctions free dans le DSL** (cycleNext, i18n(key), etc.) → si use-case émerge
- **Méthodes string** (`.toUpperCase`, `.substring`) → si demandé
- **Arithmétique étendue** (`*`, `/`) → idem (et trouver alternative à `%` modulo qui conflit avec PAPI)
- **Variables locales / let** → non prévu
- **Action `set_arg_cycle` paramétrable direction** (alternative aux deux actions séparées) → si simplification demandée

## 9. Dépendance future

**Spec B — Unification default/sample/connector live** (à brainstormer séparément)

Refonte de `Menu.sampleContext` + `ContextInput.default` + live fetch connecteurs. Le DSL n'a pas besoin d'attendre cette refonte — il consomme la nouvelle API quand elle existera. Pour V1, le DSL utilise le `Menu.sampleContext` actuel pour la preview éditeur.

## 10. Glossaire

| Terme | Sens |
|---|---|
| **Template** | String mixée : texte littéral + `{expression}` + `<MiniMessage>` + `%PAPI%` + `{i18n:key}`. Format des champs LText et autres champs texte. |
| **Expression** | String contenant UNE expression du DSL (la string entière). Format des champs `set_arg.value`, `expression.expr`, `set_arg_cycle_*.list`. |
| **DSL** | Le langage d'expressions custom embarqué (Domain-Specific Language). |
| **AST** | Abstract Syntax Tree, résultat du parsing d'une expression. Mis en cache. |
| **Scope** | Ensemble des identifiants visibles à un point donné de l'édition (inputs du menu + alias d'iteration courant + méta-iter). |
| **PAPI** | PlaceholderAPI, plugin Bukkit standard pour placeholders dynamiques (`%player_name%` etc.). |
| **MM** | MiniMessage, format de markup texte de Adventure/Paper (`<gold>`, `<bold>`, etc.). |
| **LText** | Wrapper interface pour un champ texte i18n-keyed (`{ key: I18nKey }`). |
| **MenuSession** | État runtime par joueur d'un menu ouvert (mémoire, dropped à la fermeture). |
