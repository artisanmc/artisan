# Types d'inventaire de menu (chest / hopper / dropper) — Design

> Spec brainstormée le 2026-06-14. Permet à un menu GUI d'utiliser un type de conteneur autre que le coffre. **Scope V1 : grilles d'affichage uniquement — Chest, Hopper, Dropper/Dispenser.** Les types fonctionnels (four, table de craft, enclume…) sont hors scope (slots à comportement spécial). Source de vérité pour le plan d'implémentation.

**Statut** — Spec validée en brainstorming, à transformer en plan d'implémentation.

---

## 1. Objectif & scope

Aujourd'hui un menu = **toujours un coffre** : `Menu.rows: 1|2|3|4|5|6`, grille **9 colonnes**, fond `generic_54.png`, `size = rows×9` (9–54). On veut choisir le **type d'inventaire**.

**V1 — types « grille d'affichage » uniquement** (slots cliquables, aucun comportement spécial) :

| Type | Colonnes | Lignes | Slots | Texture GUI | Bukkit `InventoryType` |
|---|---|---|---|---|---|
| `chest` (défaut) | 9 | 1–6 (variable) | rows×9 (9–54) | `generic_54.png` (existant) | `CHEST` (via taille) |
| `hopper` | 5 | 1 (fixe) | 5 | `hopper.png` (à ajouter) | `HOPPER` |
| `dropper` | 3 | 3 (fixe) | 9 | `dispenser.png` (à ajouter) | `DROPPER` (ou `DISPENSER`) |

**Hors scope (V2+)** : four/`FURNACE`, table de craft/`WORKBENCH`, enclume/`ANVIL`, brewing, enchanting… — leurs slots sont fonctionnels (smelting/craft, slots de résultat, consommation d'items) et ne se comportent pas comme des menus statiques. Décidé en brainstorm.

## 2. Principe : une table de géométrie unique

Toute la logique (éditeur, plugin, validation, export) dérive d'**une seule table** décrivant chaque type. Côté éditeur (`editor/src/features/canvas/inventoryTypes.ts`, nouveau) :

```ts
export type InventoryType = "chest" | "hopper" | "dropper";

interface InventoryGeometry {
  cols: number;                       // colonnes de la grille
  fixedRows?: number;                 // lignes fixes (hopper=1, dropper=3) ; chest = variable
  slotsFor: (rows: number) => number; // chest: rows*9 ; hopper: 5 ; dropper: 9
  textureKey: string;                 // asset du fond GUI
}

export const INVENTORY_TYPES: Record<InventoryType, InventoryGeometry> = {
  chest:   { cols: 9, slotsFor: (r) => r * 9, textureKey: "generic_54" },
  hopper:  { cols: 5, fixedRows: 1, slotsFor: () => 5, textureKey: "hopper" },
  dropper: { cols: 3, fixedRows: 3, slotsFor: () => 9, textureKey: "dispenser" },
};
```

Helpers dérivés : `colsFor(type)`, `rowsFor(type, menu.rows)` (= `fixedRows ?? rows`), `slotCount(type, rows)`, `slotXY(i, type)` (utilise `cols`). Côté plugin, table miroir `type → InventoryType`.

## 3. Modèle de données

### 3.1 Domaine (`editor/src/domain/types.ts`)
- Ajouter `Menu.inventoryType?: InventoryType` (optionnel, défaut `"chest"` à la lecture). `rows` reste, **significatif pour chest uniquement** ; pour hopper/dropper il est ignoré (lignes fixes via la table).
- `Element.positions` (string "0-8") **inchangé** : toujours des indices 0-based, simplement bornés par `slotCount(type, rows)`.

### 3.2 Schéma `menu/v1` (`docs/schema/menu/v1/schema.json`)
- **Ajout d'un champ OPTIONNEL** `inventory_type` (enum `["chest","hopper","dropper"]`, défaut `chest`). **Changement additif rétro-compatible** : un menu existant sans le champ = chest, reste valide. → reste en **menu/v1** (pas de v2 ; la règle « new version = new folder » vise les changements *cassants*, ce qui n'est pas le cas ici).
- `size` (compte de slots) **conservé** mais l'enum est élargi : `[5, 9, 18, 27, 36, 45, 54]` (5 = hopper, 9 = dropper *ou* chest 1 ligne).
- **Validation croisée** `inventory_type` ↔ `size` (ajv + `validateMenuV1`) : `chest` ⇒ size ∈ {9,18,27,36,45,54} ; `hopper` ⇒ size = 5 ; `dropper` ⇒ size = 9. Mettre à jour les fixtures/exemples + `docs/architecture/schemas-codegen.md`.

## 4. Éditeur — géométrie & rendu

### 4.1 `menuLayout.ts`
Aujourd'hui `COLS = 9` est constant et `slotXY(i)` fait `i % 9` / `i / 9` ; `menuBoxSize(rows)` et les crops texture sont chest-only. Paramétrer par type :
- `COLS` → `colsFor(type)`.
- `slotXY(i, type)` → `col = i % cols`, `row = floor(i / cols)`.
- `menuBoxSize(type, rows)` → largeur/hauteur selon la texture du type (chest 176px ; hopper/dropper plus étroits).
- Le slicing texture (`topPieceCrop`/`bottomPieceCrop`, spécifique `generic_54.png`) → sélection par `textureKey` ; chaque type a ses dimensions de fond. Les hopper/dropper ont un fond fixe (pas de slicing par lignes).
- `nodeBox(pack, id, layout)` (utilisé par Edges/GhostChips) → tient compte du type pour la taille du menu sur la planche.

### 4.2 Textures
Ajouter les fonds GUI vanilla **hopper** et **dispenser** au pipeline d'assets éditeur (à côté de `generic_54.png`). Source : textures GUI vanilla Minecraft (mêmes que celles déjà récupérées par `gen-items`/assets MC). Documenter dans `editor-internals.md`.

### 4.3 Rendu (`MenuGroup` + `SoloMenuStage`)
`MenuGroup` lit `menu.inventoryType`, choisit la texture de fond + la géométrie de slots via la table. Le **même** composant rend les 3 types (pas de fork). Title composer : tous ces conteneurs ont une barre de titre — le rendu titre s'applique. ⚠️ **Complexité notable** : le pipeline de pixel-offsets du title composer suppose la largeur chest (`contentWidth`/176). Hopper/dropper sont plus étroits → passer une **largeur de contenu par type** au composer. (Le titre fonctionne dans tous les cas ; seuls les offsets pixel-perfect dépendent de la largeur.)

## 5. Éditeur — UX

### 5.1 Sélecteur de type (`MenuProperties`)
Ajouter un sélecteur **« Type d'inventaire »** (Chest / Hopper / Dropper), via le design system (`components/ui` — Select/SegmentedControl ou DropdownMenu). Quand `chest` → afficher le sélecteur de **lignes (1–6)** existant ; sinon le masquer (lignes fixes).

### 5.2 Changement de type avec items hors-bornes
Passer d'un grand type à un plus petit (ex. chest 54 → hopper 5) peut laisser des éléments dont `positions` dépasse le nouveau `slotCount`. **Comportement : conserver les données + afficher un avertissement** (chip « N éléments hors de l'inventaire ») dans `MenuProperties` ; **ne pas supprimer** silencieusement. (Alternative rejetée : auto-drop.) Le rendu canvas n'affiche que les slots in-range ; l'export filtre déjà les positions hors-bornes côté plugin (`parsePositions … filter { it in 0 until size }`).

### 5.3 Création
`NewMenuDialog` crée un **chest** par défaut ; le type se change ensuite dans `MenuProperties` (création simple, pas de picker supplémentaire à la création).

## 6. Plugin (Kotlin)

- `MenuYaml` (`PackBundle.kt`) : ajouter `@JsonProperty("inventory_type") val inventoryType: String = "chest"`.
- `MenuRenderer.kt` : si `inventoryType != "chest"`, créer via `Bukkit.createInventory(holder, InventoryType.HOPPER|DROPPER, title)` ; sinon garder l'appel par taille (`createInventory(holder, size, title)`). Table `type → InventoryType` côté plugin. Le fallback legacy (titre `String`) est conservé pour les deux chemins.
- Population des slots **inchangée** : `parsePositions(positions, size)` borne déjà à `0 until size` ; pour hopper `size=5`, dropper `size=9`.
- Tests plugin : ouverture hopper/dropper crée le bon `InventoryType` + taille ; un menu sans `inventory_type` reste un coffre.

## 7. Export / import / migration

- `transform.ts` `serializeMenuToV1` : émettre `inventory_type` **seulement si ≠ chest** (rétro-compat propre) ; `size = slotCount(type, rows)` (chest rows×9, hopper 5, dropper 9).
- `menuV1ToDomain.ts` : lire `inventory_type` (défaut `chest`) ; pour chest, `rows = size/9` (inchangé) ; pour hopper/dropper, `rows` non pertinent (la table fixe la géométrie).
- **Migration** : aucune migration de données — un menu existant sans `inventory_type` est traité comme chest partout (défaut). Les packs sur disque restent valides.

## 8. Tests

| Couche | Couverture |
|---|---|
| `inventoryTypes.ts` | table + `colsFor`/`slotCount`/`slotXY` par type (hopper 5×1, dropper 3×3, chest 9×rows). |
| `menuLayout` | `slotXY(i, type)` correct par type ; `menuBoxSize` par type. |
| Schéma | `validateMenuV1` : validation croisée size↔type (hopper⇒5, dropper⇒9, chest⇒multiple de 9) ; menu sans `inventory_type` = valide (chest). |
| Export/import | round-trip domaine→v1→domaine pour les 3 types ; back-compat (v1 sans champ → chest). |
| Éditeur UX | sélecteur de type ; rows caché hors chest ; warning items hors-bornes au switch. |
| Plugin | `MenuRenderer` crée le bon `InventoryType`/taille ; menu sans champ = coffre ; slots hors-bornes ignorés. |

## 9. Non-goals (V1)

- Types fonctionnels (four, craft, enclume, brewing, enchanting, beacon, grindstone…) — slots à comportement spécial, reportés.
- Layouts custom / colonnes arbitraires hors des types Minecraft réels.
- Édition du type à la création (création = chest ; changement en properties).
- Title composer pixel-perfect avancé sur hopper/dropper : la largeur par type est câblée, mais si une fonctionnalité titre s'avère trop couplée à la largeur chest, elle peut être gated chest-only en V1 (à confirmer à l'implémentation).
