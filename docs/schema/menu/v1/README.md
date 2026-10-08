# Artisan — Menu schema v1

Format intermédiaire d'un menu Artisan. C'est le **contrat** entre l'éditeur web (`editor.artisanmc.net`) et le plugin Minecraft : tant que les deux côtés respectent ce schéma, ils sont découplés.

## Fichiers

| Fichier | Rôle |
|---|---|
| `schema.json` | JSON Schema (Draft 2020-12), source de vérité validable par machine |
| `types.ts` | Types TypeScript pour l'éditeur et le futur MCP server |
| `examples/minimal.json` | Plus petit menu valide (1 layer, 1 element). |
| `examples/shop-with-states.json` | Shop avec apparences conditionnelles (3 variantes pour le bouton VIP). |
| `examples/paginated-quests.json` | Liste paginée avec boutons prev/next auto-bind. |
| `examples/multi-paginated.json` | Deux listes paginées dans le même menu, binding explicite via `element_id`. |
| `examples/deco-with-conditional-button.json` | Pattern phare : layer décoration + layer items, fall-through quand un bouton est conditionnel. |
| `examples/data-driven-shop.json` | Element itératif sur un `contextInput` de type `list` peuplé par la data source `chestshop:items` — un slot par item shop, avec apparences conditionnelles sur `{shop.rarity}`. |

## Vocabulaire

Pour éviter la confusion :

- **Position** (Minecraft) : un emplacement dans l'inventaire, indexé de 0 à 53. Ce que le jeu appelle "slot".
- **Element** (Artisan) : l'objet manipulé par l'admin (bouton, décoration, liste paginée...). Un Element occupe une ou plusieurs positions et a une ou plusieurs apparences.
- **Layer** : conteneur qui groupe des Elements liés thématiquement (décoration, items, navigation...). Les layers sont ordonnés bottom→top et permettent du chevauchement contrôlé entre couches.
- **Appearance** : variante visuelle d'un Element. Évaluée dans l'ordre, première dont la condition matche gagne.
- **Bundle** (séparé du Project) : artefact runtime signé que le plugin télécharge depuis le CDN. Concept distinct du project.

## Modèle conceptuel

```
Menu
 ├── meta (schema, id, title, size, permission)
 ├── lifecycle (open_requirements, open_actions, close_actions)
 ├── background : Appearance     ← fallback ultime quand aucun layer ne rend
 └── layers : Layer[]            ← ordre bottom → top
       └── Layer
            ├── id (slug, ex. "decoration")
            ├── name (affiché dans l'éditeur)
            └── elements : Element[]
                  └── Element
                       ├── id           (stable, unique cross-layer)
                       ├── positions    ("15" ou "10-43")
                       ├── <champs du display>          ← à plat sur l'Element
                       ├── states ?     : Appearance[]   ← essayés AVANT le display
                       ├── template_ref ?
                       └── tags ?
```

## Sémantique de rendu

Pour chaque position 0 à `size-1`, le moteur fait :

1. Parcourt les layers de **haut en bas** (`menu.layers` lu en ordre inverse — dernier de la liste = top)
2. Pour chaque layer, identifie l'Element qui revendique cette position (last-placed-wins en cas d'overlap intra-layer)
3. Évalue les `states` de l'Element dans l'ordre. **Le premier dont `if` passe gagne** → render à cette position, terminé pour ce slot
4. Si aucun état ne passe, le **display** (les champs d'apparence portés à plat par l'Element) est rendu — c'est le repli, il s'applique toujours
5. Aucun layer ne fournit un Element rendu → render `menu.background` si défini, sinon position vide (AIR)

## Décisions de design

### Layers first-class

Les Layers sont des entités à part entière (`Layer` avec id, name, elements), pas juste des tags. Pourquoi :

- **Copy-paste cross-menus** : on copie un layer entier d'un menu à un autre, en une opération atomique
- **Symbols / Templates de layers** (V2) : un layer "navigation moderne" devient un Symbol instanciable
- **Marketplace** (V3) : un créateur peut vendre un project "Layer décoration médiéval"
- **Mental model** : Photoshop / Figma traitent les layers comme des conteneurs avec enfants

### Display à plat + states, sans partial override

Le cas nominal — un Element, une apparence — s'écrit **sans emballage** : `material`, `title`,
`lore`, `click` sont des clés de l'Element, comme dans les autres plugins de menu. C'est ce que
100 % des Elements réels utilisent. Les alternatives conditionnelles vivent sous `states`.

Un état **remplace** le display, il ne le complète pas : ce qu'il n'écrit pas est **absent**,
jamais hérité. Le merge (« le state ne dit que ce qui change ») a été examiné et écarté — il
demande d'inventer des règles (effacer un lore hérité, fusionner les `click`, redéfinir
partiellement un `nbt`) sans aucune donnée d'usage pour les informer. Bénéfices du remplacement :

- Chaque apparence est self-contained (pas de « j'hérite de quoi déjà ? »)
- Plus AI-friendly (lire un état suffit à savoir ce qui s'affiche)
- Le moteur prend le premier état qui matche, sinon le display, point

Prix à payer, assumé : un Element multi-états répète les champs communs. L'éditeur ne masque PAS
ce prix — « Ajouter un état » crée un état **vide**, et le bloc de pierre qu'il affiche
immédiatement enseigne la sémantique ; « Dupliquer » est le geste explicite d'à côté.

Cf. ADR `element-display-and-states`.

### Pas de validation d'overlap stricte

Au sein d'un même layer, deux Elements peuvent revendiquer la même position : **last-placed-wins**, l'éditeur affiche un warning mais ne bloque pas. C'est plus permissif que d'errorer, et ça permet à l'admin de superposer rapidement sans friction.

Entre layers différents, l'overlap est **intentionnel** (c'est le pattern fall-through pour les boutons conditionnels + déco en dessous).

### Chemins de références

- `pagination_next.element_id` / `pagination_prev.element_id` / `pagination_at_first.element_id` / `pagination_at_last.element_id` réfèrent un Element par son `id` (cross-layer, unique dans le menu).
- `template_ref.id` réfère un template stocké à part.

### Choix conservés

**`size` enum.** Limité à `{9, 18, 27, 36, 45, 54}` via `enum`.

**`custom_model_data` est une string.** 1.21.4+ uniquement.

**`asset` vs `material`.** Tous les deux optionnels. Asset prime si présent (rendu via CMD string). Material seul = item vanilla. Ni l'un ni l'autre = position visiblement AIR (utile pour les Elements purement structurels).

**Click `null` dans une Appearance.** Signifie "non-cliquable explicitement". Si `click` est juste absent (undefined), l'Appearance n'est pas cliquable non plus — `null` sert juste à expliciter l'intention pour la lisibilité.

**Composants tiers.** `ClickHandler = StandardClick | ComponentClick`, discriminé par `use_component_default`.

## Format des champs texte

Tous les champs texte du schéma (`title`, `lore[]`, `send_message.text`, `broadcast.text`, `cooldown.message`, `give_item.name`, `give_item.lore[]`, etc.) suivent une convention de contenu unifiée :

- **Format MiniMessage** (Adventure / Paper) — tags `<color>`, `<bold>`, `<gradient>`, `<click>`, `<hover>`, etc. Cf. https://docs.advntr.dev/minimessage/format.html
- **Référence i18n inline** : `{i18n:menu.shop.title}` est résolu à l'exécution depuis le fichier translations du project (cf. `translations/v1`).
- **Placeholders PAPI** : `%player_name%`, `%vault_eco_balance%`, `%args_target%` (si ouvert depuis une commande), etc.
- **Codes legacy `§a`** acceptés en input mais convertis en MiniMessage au save (canonicalisation backend, opt-out project).

Ordre de résolution côté plugin : (1) `{i18n:...}` → valeur stockée pour la langue active, (2) `%placeholder%` → résolu via PAPI, (3) parse MiniMessage final → Component Adventure envoyé au joueur.

Schéma : aucun changement — les champs restent `string`. C'est une convention de contenu, validée et rendue par le moteur de l'éditeur et du plugin.

## Contexte du menu et data sources

Tout flux de données entrant dans un menu — qu'il vienne de l'appelant ou d'une data source tierce — passe par `Menu.contextInputs`. Chaque entrée est une **slot nommée et typée** que le menu déclare ; sa valeur peut venir de trois sources :

- **Appelant** : la commande ou le menu parent passe la valeur à l'ouverture (auto-binding par nom, cf. main-spec §15.4).
- **Data source** : la slot porte un `source: ConnectorBinding` ; le moteur appelle la data source référencée et stocke le résultat.
- **Default** : valeur littérale fallback.

Un Element devient itératif en pointant `iterates: { source, alias }` vers une slot de type `"list"` (peu importe que la liste vienne de l'appelant ou d'une data source — c'est opaque côté Element). Les champs accèdent à l'item courant via `{alias.field}`. Concept détaillé en `main-spec.md` section 14.

```json
{
  "contextInputs": [
    { "name": "category", "type": "string" },
    {
      "name": "shops",
      "type": "list",
      "source": {
        "ref": "chestshop:items",
        "filter": { "category": "{category}" },
        "sort": { "by": "price", "direction": "asc" },
        "limit": 28
      }
    }
  ],
  "layers": [{
    "id": "items",
    "elements": [{
      "id": "shop_grid",
      "positions": "10-43",
      "iterates": { "source": "shops", "alias": "shop" },
      "material": "{shop.material}",
      "title": "<gold>{shop.name}</gold>",
      "lore": ["<yellow>Prix : {shop.price} pièces</yellow>"],
      "click": { "left": { "actions": [{ "type": "run_command", "command": "cs buy {shop.id}" }] } },
      "states": [
        {
          "if": [{ "type": "placeholder_equals", "placeholder": "{shop.rarity}", "value": "legendary" }],
          "material": "{shop.material}",
          "title": "<gold>{shop.name}</gold>",
          "lore": ["<yellow>Prix : {shop.price} pièces</yellow>"],
          "enchanted": true,
          "click": { "left": { "actions": [{ "type": "run_command", "command": "cs buy {shop.id}" }] } }
        }
      ]
    }]
  }]
}
```

Règles :

- `iterates` et `appearance.component_ref` sont **mutuellement exclusifs** sur un même Element. `validateMenuLayout` flag les erreurs.
- `iterates.source` doit pointer vers un `contextInput` déclaré et de type `"list"`. `validateMenuLayout` flag les erreurs.
- `ConnectorBinding.source` est valide uniquement sur `type: "list"` et `type: "object"`.
- Les valeurs `params` / `filter` du `ConnectorBinding` interpolent les autres `contextInputs` du menu via `{name}`.
- Pas de cycle dans les dépendances entre `contextInputs` : si `filter` réfère `{X}`, la slot `X` doit être résoluble en amont (appelant ou data source sans dépendance circulaire).
- Conditions sur les champs de l'item d'iteration : utiliser `placeholder_equals` / `placeholder_match` avec `{alias.field}` comme placeholder. Les anciennes conditions `data_field_*` ont été retirées.
- Le namespace du `ref` (`chestshop`, `essentials`, `jobs`, ...) est ajouté automatiquement à `metadata.uses_plugins`.

## Navigation arrière (retour)

L'action sans argument **`open_previous_menu`** rouvre l'écran précédent de
l'historique du joueur (menu **ou** dialog). L'historique est une **pile LIFO** :
`open_menu` / `open_dialog` empilent l'écran quitté, `open_previous_menu` le
dépile sans ré-empiler l'écran courant. Conséquence voulue : `menu → wiki → item`
revient au menu en **deux** retours, sans va-et-vient `item ↔ wiki`. Pile vide =
no-op. Un `open_menu` vers l'écran juste avant (même id, args ignorés) compte
comme un retour, pour qu'un bouton retour câblé en `open_menu` ne boucle pas.

```yaml
elements:
  - id: back
    positions: 0
    click:
      left:
        - open_previous_menu
    states:
      # Le bouton n'apparaît que s'il y a un historique : sans état qui matche,
      # le display vide laisse la position en AIR.
      - if:
          - expression: has_previous_menu
        material: ARROW
        title: { en: "Back", fr: "Retour" }
```

Placeholders disponibles au rendu de tout écran : `{has_previous_menu}`
(booléen) et `{previous_menu.id}` / `{previous_menu.title}` (l'écran précédent).

## Rafraîchir après une commande de module

`set_arg` re-rend le menu courant **sans** les données qu'il avait récupérées : ses sources
sont ré-interrogées. Après une commande de module qui change ces données (accorder une
permission, promouvoir un membre), on enchaîne donc :

```yaml
click:
  left:
    - run_command: "msguilds:rank_permission {rank_id} {p.key}"
    - set_arg: { arg: refresh, value: "1" }
```

`open_menu` vers le même menu ré-interroge aussi les sources, mais empile l'historique : le
bouton retour reviendrait sur le même écran.

## Limitations connues (cross-field non-exprimables en JSON Schema)

À valider au load par `validateMenuLayout` (cf. `types.ts`) :

- IDs uniques cross-layer pour les Elements
- IDs uniques pour les Layers
- Positions dans `[0, size)` pour chaque Element
- Overlap intra-layer = warning (pas une erreur)
- `pagination_*.element_id` doit pointer vers un Element existant — vérifié au publish par l'éditeur
- range `"10-43"` cohérent avec un `component_ref` paginable — vérifié via la registry des plugins tiers

## Comment l'utiliser

### Côté éditeur (TypeScript)
```ts
import type { Menu, Element, Layer, Appearance, Action } from "./schema/menu/v1/types";
import { validateMenuLayout } from "./schema/menu/v1/types";
import schema from "./schema/menu/v1/schema.json";
```

### Côté plugin (Java)
Codegen depuis `schema.json` avec `jsonschema2pojo`. Au load d'un menu, valider contre le schéma puis appliquer `validateMenuLayout` (port Java).

### Validation locale
```bash
npm install ajv ajv-formats
node validate.mjs
```

## Prochaines étapes côté schéma

1. **CI hook** : ajv sur les examples à chaque PR.
2. **Schéma `template/v1`** : sortir le shape Template de `types.ts` vers son propre JSON Schema.
3. **Schéma `pack/v1`** : déjà fait, voir `docs/schema/pack/v1/`.
4. **Schéma `command/v1`** : déjà fait, voir `docs/schema/command/v1/`.
5. **Schéma `translations/v1`** : déjà fait, voir `docs/schema/translations/v1/`.
6. **Codegen Java** depuis `schema.json` pour le plugin.
