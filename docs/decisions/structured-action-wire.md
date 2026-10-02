# Wire d'action structuré — YAML keyed par nom, DSL éliminé

**Status:** proposed (2026-09-30)

## Contexte

L'ADR `action-dsl` (2026-07-21) a fait de la **string DSL** la sérialisation
canonique d'une chaîne d'actions (`Step[]`), pour rendre un fichier data éditable
à la main. Les handlers de menu/commande/dialog sont donc un **scalaire** DSL
(`click.left: 'send_message "…"'`), où un texte est `"littéral"` ou `@clé`.

L'ADR `field-local-translations` (2026-09-30) a rendu les textes **structurels**
auto-contenus : un slot porte soit une string (valeur de `defaultLang`), soit une
map `{ <lang>: texte }`. Mais **un scalaire DSL ne peut pas contenir de map** :
les textes d'action sont restés en `@clé` vers `lang/<lang>.yaml`, donc un
document copié n'emporte pas ses messages d'action. La forme spéciale du DSL
contredit aussi le modèle field-local (string nue = `defaultLang`).

Options pesées : **A** statu quo (actions globales) — gap assumé ; **B** table
`translations:` document-locale — indirection que le reste du modèle n'a pas ;
**E** étendre la grammaire DSL avec un littéral-map inline — syntaxe inventée,
deux parseurs, lignes géantes ; **D** wire structuré — le seul qui donne au texte
d'action la même forme que le structurel. Retenu : **D**, et le DSL lui-même est
**éliminé** (il n'était qu'un format de stockage spécialisé ; le structuré keyed
le remplace avantageusement).

## Décision

1. **La sérialisation canonique d'une chaîne d'actions est structurée (YAML),
   keyed par nom.** Révise la décision 1 de `action-dsl` et supersede sa cible
   Phase 2.

2. **Une action = map à une clé : le nom de l'action.**

   ```yaml
   - send_message: "Bienvenue !"                          # 1 arg texte
   - send_message: { en: "Welcome!", fr: "Bienvenue !" }  # 1 arg, field-local
   - close_menu:                                          # 0 arg (valeur nulle)
   - give_money: 100                                      # 1 arg nombre
   - run_command: { command: "say hi", as: console }      # 2 args
   - open_menu: { menu_id: shop_category, context: { category: "{cat.id}" } }
   - show_title: { title: "VIP", subtitle: "§7bienvenue" }
   ```

   - **1 seul argument** → la valeur EST cet argument.
   - **0 argument** → valeur nulle (`- close_menu:`), ou **string nue en entrée de
     liste** (`- close_menu`) ; les deux formes sont lues, l'éditeur écrit la nue.
   - **plusieurs arguments** → une map `{ arg: valeur }`.

3. **Une condition = map à une clé : le nom de la condition.** Le `if:` porte une
   **liste = AND implicite** ; `or:` / `and:` / `not:` sont des nœuds explicites
   (`or:`/`and:` prennent une liste, `not:` une condition). Le `joins` plat est
   retiré.

   ```yaml
   - if:
       - has_permission: shop.vip
       - or:
           - world_is: world_nether
           - time_is: night
     do:
       - show_title: { title: { en: "VIP", fr: "VIP" }, subtitle: "§7Welcome" }
       - send_message: { en: "Access granted", fr: "Accès accordé" }
     else:
       - if:
           - random_chance: 0.1
         do:
           - open_dialog: lucky_draw
         else:
           - send_message: { en: "You need VIP.", fr: "Il faut être VIP." }
   ```

   `else if` = un `if` **en tête du `else`** (récursion), pas de `cases`.
   *Rejeté :* `anyOf`/`allOf`/`oneOf` — c'est le vocabulaire JSON Schema qui
   valide déjà ces fichiers ; `oneOf` = XOR (faux ami), `anyOf`/`allOf` créent une
   collision de vocabulaire dans le même écosystème.

4. **Un texte d'action est un `LocalizedText`** : string nue (= valeur du
   `defaultLang`, même sémantique que le structurel) ou map `{ <lang>: texte }`.
   `{i18n:key}` reste une **valeur** possible (clé partagée), résolue avec le repli
   habituel. Templates `{player}`, `%papi%`, MiniMessage restent (accolades
   réservées).

5. **Le DSL est éliminé.** Le wire structuré est l'unique représentation stockée
   et échangée. Le codec `actiondsl` (lexer/parser/printer/`DslToEngine`, TS **et**
   Kotlin) et les fixtures `action-dsl-fixtures.json` sont retirés ; l'ambition
   « DSL portable dans Artisan Core » (`action-dsl` §Portability) tombe. L'édition
   des steps passe par un **éditeur structuré** (formulaire : ajouter une action/
   condition → choisir le type → champs ; arbre if/else). L'**évaluateur de
   `expression`** reste — il n'est pas le DSL d'actions.

6. **Discrimination par type (lecture tolérante).** Un handler est une **string**
   → ancien DSL legacy ; une **map** → un step unique ; une **liste** → des steps
   (entrée string = action sans argument). Le plugin accepte les deux formes
   pendant la migration ; l'éditeur écrit le structuré. Migration **paresseuse** :
   un ancien fichier DSL se lit et se ré-écrit structuré au premier save.

7. **Le sous-système d'adresses d'action est retiré** (`assignI18nAddresses`, les
   champs `i18n`/`i18nTitle`/`i18nSubtitle`). Le texte d'action est
   inline/field-local.

8. **Portée.** Menus, commandes, dialogs **et** les champs `actions` des data
   sources (kind `actions`, ADR `yaml-assisted-editing`) : un seul wire partout.

## Conséquences

- Uniformité : tout texte (structurel **et** action) est un `LocalizedText` sur le
  disque. `lang/` ne porte plus que les clés sans site (`artisan.duration.*`) et
  les adresses des data sources.
- **Nouveau chantier UI** : un éditeur de steps structuré remplace
  `ControlledStepsEditor` (DSL). Le plus gros morceau côté éditeur.
- **Changement de wire** : migration de tous les menus/commands/dialogs, du
  compilateur plugin, des outils assistant, et des vecteurs de conformité
  (`menuV1.test`, `canonical.test`, `menuV1ToDomain.roundtrip`).
- Schéma : les defs `Action`/`Condition` `type:`-tagged laissent place à la forme
  **keyed** ; `ActionParser`/`ConditionParser`/`StepParser` plugin réécrits.
  `menu/v1` évolue **en place** (pas de v2) — la lecture tolérante du DSL couvre
  les fichiers déjà en prod.
- Suppression : codec `actiondsl` (deux stacks), `DslToEngine`, fixtures DSL,
  portabilité du DSL dans le core. Le leaf evaluator d'`expression` survit.
- **Supersede** `action-dsl` en quasi-totalité (décision 1, cible Phase 2,
  portabilité) ; ses décisions sur l'expression runtime (6) restent pour
  `expression`.
