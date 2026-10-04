# Wire d'action structuré — référence

Source de vérité du format des chaînes d'actions (menus, commandes, dialogs, data
sources). ADR : `docs/decisions/structured-action-wire.md`. Le format est un YAML
**keyed par nom** ; le DSL d'actions n'existe plus (lecture legacy tolérée le
temps de la migration).

## Action — une map à une clé

Le nom de l'action est la clé. Le nombre d'arguments décide de la forme :

| Cas | Forme | Exemple |
|---|---|---|
| 1 argument | la valeur EST l'argument | `send_message: "Bienvenue !"` |
| 0 argument | string nue (canonique) | `- close_menu` |
| 0 argument (lu aussi) | valeur nulle | `- close_menu:` |
| plusieurs arguments | une map | `show_title: { title: "VIP", subtitle: "§7…" }` |

```yaml
click:
  left:
    - send_message: "Bienvenue !"                       # 1 arg
    - give_money: 100                                   # 1 arg nombre
    - run_command: "say hi"                             # 1 arg (as: player par défaut)
    - run_command: { command: "op", as: console }       # 2 args
    - open_menu: shop_category                           # 1 arg
    - open_menu: { menu_id: shop, context: { cat: "{cat.id}" } }
    - close_menu                                        # 0 arg
    - close_dialog
    - open_previous_menu                                # 0 arg — bouton retour
```

### `open_previous_menu` — bouton retour

Ré-ouvre l'écran précédent de l'historique de navigation du joueur (menu **ou**
dialog). C'est une **pile LIFO** : l'ouverture d'un écran (`open_menu` /
`open_dialog`) empile l'écran quitté, et `open_previous_menu` le **dépile** sans
ré-empiler l'écran courant. La pile décroît donc à chaque retour — `menu → wiki →
item` demande deux retours pour revenir au menu, sans va-et-vient `item ↔ wiki`.
Pile vide = no-op. Un `open_menu` / `open_dialog` qui rouvre l'écran juste avant
(même id et project, args ignorés) compte comme un retour : il dépile au lieu
d'empiler, donc un bouton retour câblé en `open_menu parent` ne boucle pas.
Placeholders associés : `{has_previous_menu}` (booléen, pour
conditionner le bouton) et `{previous_menu.id}` / `.title`.

### Texte d'action — field-local

Un texte d'action est un `LocalizedText`, **exactement comme un texte
structurel** : une string (valeur du `defaultLang`) ou une map
`{ <lang>: texte }`.

```yaml
- send_message: { en: "Welcome!", fr: "Bienvenue !" }
- show_title:
    title: { en: "VIP", fr: "VIP" }
    subtitle: "§7Welcome"
    stay: 40
```

Un `{i18n:key}` reste une valeur possible (clé partagée) ; les templates
`{player}`, `%papi%` et MiniMessage restent (accolades réservées).

## Condition — une map à une clé

`if:` porte une **liste = AND implicite**. `or:` / `and:` prennent une liste,
`not:` une condition. `else if` = un `if` **en tête du `else`**.
Les `joins` plats de l'éditeur s'encodent de gauche à droite, sans précédence
(sémantique historique du plugin) : `A and B or C` → `or: [and: [A, B], C]`,
`A or B and C` → `[or: [A, B], C]` (`conditionsToStructured`).

```yaml
- if:
    - has_permission: shop.vip
    - or:
        - world_is: world_nether
        - time_is: night
  do:
    - send_message: { en: "Access granted", fr: "Accès accordé" }
  else:
    - send_message: { en: "You need VIP.", fr: "Il faut être VIP." }
```

Conditions scalaires vs map :

```yaml
- has_permission: shop.use                 # 1 arg
- random_chance: 0.1                       # 1 arg
- world_is: world_nether                   # 1 arg
- has_item: { material: DIAMOND, count: 3 } # 2 args
- placeholder_equals: { placeholder: "%rank%", value: "vip" }
- placeholder_match: { placeholder: "%server_type%", regex: "^premium" }
- time_is: night                           # scalaire (ou { from_ticks, to_ticks })
- not:
    world_is: world_nether
```

## Exemple complet

```yaml
elements:
  - id: shop
    positions: 13
    material: PAPER
    title: { en: "Shop", fr: "Boutique" }
    click:
      left:
        - if:
            - has_permission: shop.vip
            - or:
                - placeholder_match: { placeholder: "%server_type%", regex: "^premium" }
                - world_is: world_nether
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

## Lecture tolérante (migration)

Un handler (`click.left`, `commands.actions`, `dialogs…actions`) peut être :

- une **string** → ancien Action DSL (lu tel quel, ré-écrit structuré) ;
- une **map** → un step unique ;
- une **liste** → des steps ; une entrée string = action sans argument
  (`- close_menu`), équivalente à `- close_menu:`.

## Notes

- Mot-clés combinateurs : **`or` / `and` / `not`** (pas `anyOf`/`oneOf`/`allOf` —
  `oneOf` serait un XOR, et ces noms sont déjà le vocabulaire JSON Schema qui
  valide ces fichiers).
- Les `if` d'appearance/state partagent le même format de condition (type
  keyed) — un seul format partout.
