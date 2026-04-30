# Interfaze — Menu schema v1

Format intermédiaire d'un menu Interfaze. C'est le **contrat** entre l'éditeur web (`editor.interfaze.gg`) et le plugin Minecraft : tant que les deux côtés respectent ce schéma, ils sont découplés.

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

## Vocabulaire

Pour éviter la confusion :

- **Position** (Minecraft) : un emplacement dans l'inventaire, indexé de 0 à 53. Ce que le jeu appelle "slot".
- **Element** (Interfaze) : l'objet manipulé par l'admin (bouton, décoration, liste paginée...). Un Element occupe une ou plusieurs positions et a une ou plusieurs apparences.
- **Layer** : conteneur qui groupe des Elements liés thématiquement (décoration, items, navigation...). Les layers sont ordonnés bottom→top et permettent du chevauchement contrôlé entre couches.
- **Appearance** : variante visuelle d'un Element. Évaluée dans l'ordre, première dont la condition matche gagne.
- **Bundle** (séparé du Pack) : artefact runtime signé que le plugin télécharge depuis le CDN. Concept distinct du pack.

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
                       ├── appearances  : Appearance[]   ← première qui matche gagne
                       ├── template_ref ?
                       └── tags ?
```

## Sémantique de rendu

Pour chaque position 0 à `size-1`, le moteur fait :

1. Parcourt les layers de **haut en bas** (`menu.layers` lu en ordre inverse — dernier de la liste = top)
2. Pour chaque layer, identifie l'Element qui revendique cette position (last-placed-wins en cas d'overlap intra-layer)
3. Évalue les `appearances` de l'Element dans l'ordre. **Première dont `if` matche** (ou `if` absent = match implicite) **gagne** → render à cette position, terminé pour ce slot
4. Si aucune appearance ne matche → l'Element n'est pas rendu, **fall-through au layer suivant**
5. Aucun layer ne fournit un Element rendu → render `menu.background` si défini, sinon position vide (AIR)

## Décisions de design

### Layers first-class

Les Layers sont des entités à part entière (`Layer` avec id, name, elements), pas juste des tags. Pourquoi :

- **Copy-paste cross-menus** : on copie un layer entier d'un menu à un autre, en une opération atomique
- **Symbols / Templates de layers** (V2) : un layer "navigation moderne" devient un Symbol instanciable
- **Marketplace** (V3) : un créateur peut vendre un pack "Layer décoration médiéval"
- **Mental model** : Photoshop / Figma traitent les layers comme des conteneurs avec enfants

### Appearances unifiées (pas de partial override)

Plutôt que `default + states[]` avec partial override, un Element a une liste d'`appearances`, chacune complète et auto-suffisante. La première dont `if` matche gagne. Une appearance sans `if` matche toujours et sert de fallback.

Trade-off : JSON un peu plus verbeux dans les Elements multi-state. Bénéfices :

- Sémantique uniforme (pas de "default vs state")
- Fall-through naturel (pas besoin de flag `hidden`)
- Chaque appearance est self-contained (pas de "j'hérite de quoi déjà ?")
- Plus AI-friendly (une IA lit une appearance, elle a tout)
- Le moteur prend la première qui matche, point

L'éditeur cushionne la verbosité : "+ Ajouter une variante" pré-remplit le formulaire avec une copie de la dernière appearance, l'admin modifie juste les champs qui changent.

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
- **Référence i18n inline** : `{i18n:menu.shop.title}` est résolu à l'exécution depuis le fichier translations du workspace (cf. `translations/v1`).
- **Placeholders PAPI** : `%player_name%`, `%vault_eco_balance%`, `%args_target%` (si ouvert depuis une commande), etc.
- **Codes legacy `§a`** acceptés en input mais convertis en MiniMessage au save (canonicalisation backend, opt-out workspace).

Ordre de résolution côté plugin : (1) `{i18n:...}` → valeur stockée pour la langue active, (2) `%placeholder%` → résolu via PAPI, (3) parse MiniMessage final → Component Adventure envoyé au joueur.

Schéma : aucun changement — les champs restent `string`. C'est une convention de contenu, validée et rendue par le moteur de l'éditeur et du plugin.

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
