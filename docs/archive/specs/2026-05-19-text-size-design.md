# Text size for menu title text + textarea layers — design

**Date:** 2026-05-19
**Status:** Approved (pending review)

## Problème

Les layers `text` et `textarea` du titre de menu se rendent toujours à la taille vanilla (height 8). L'utilisateur veut pouvoir choisir entre plusieurs tailles fixes (petit / normal / gros / etc.) par layer, pour créer des hiérarchies visuelles (titre + sous-titre, headlines, fine-print).

## Décisions clés

- **Champ `size` par layer**, restreint à l'enum `{4, 8, 12, 16, 20, 24, 32}` (multiples de 4). Default = 8 (= vanilla, backward-compat).
- **Restriction aux multiples de 4** : les autres valeurs interpolent la PNG vanilla et rendent flou. Le set choisi garantit un rendu net.
- **Bake systématique** d'une matrice `text_y{Y}_h{H}.json` (Y ∈ [-32, 172] × H ∈ {4, 8, 12, 16, 20, 24, 32}) = 1400 fichiers ~700KB JSON. Coût acceptable, code path simple (pas de bake on-demand).
- **Scope : vanilla text seulement.** Si le layer a un `fontAssetId` (custom font importée), le champ `size` est masqué — la taille d'une custom font est définie par son import.
- **Pas de migration.** YAML legacy sans `size` → default 8 → comportement actuel inchangé.

## Schéma `MenuTitleLayer`

```ts
// editor/src/domain/types.ts
export type TextSize = 4 | 8 | 12 | 16 | 20 | 24 | 32;

| { kind: "text"; value: LText; x: number; y: number;
    fontAssetId?: AssetId; color?: string;
    size?: TextSize }   // default 8

| { kind: "textarea"; value: LText; x: number; y: number;
    width: number; lineHeight: number;
    alignment: "left" | "center" | "right";
    fontAssetId?: AssetId;
    size?: TextSize }   // default 8
```

YAML on-wire mirror : `size: 16` (entier). Omis si égal à 8 (default), pour minimiser le diff sur les packs existants.

## Resource pack

### Renommage `text_y{Y}.json` → `text_y{Y}_h{H}.json`

Aujourd'hui : `backend/src/lib/resourcePackBuilder.ts` bake `text_y{Y}.json` pour Y ∈ [-32, 172] via `buildTextYFontJson(y)` à `backend/src/lib/fontJsonBuilder.ts:103`. Le plugin (`TitleCompiler.kt`) référence `<font:artisan:text_y${clampedY}>`.

Nouveau : `buildTextYFontJson(y, h)` accepte un height. Pour chaque (Y, H) du produit cartésien, émet `text_y{Y}_h{H}.json`. Le plugin référence `<font:artisan:text_y${Y}_h${H}>` avec H=8 par défaut quand le layer n'a pas de `size`.

### Échelle de rendu

Chaque provider bitmap (ASCII, accented, non-latin) a un `height` "naturel" vanilla (`VANILLA_ASCII.height`, etc.). Pour une taille H, on multiplie chaque provider par le scale factor `H / 8` :

```ts
const scale = H / 8;
{
  type: "bitmap",
  file: "minecraft:font/ascii.png",
  ascent: VANILLA_ASCII.ascent + (6 - y),         // unchanged
  height: VANILLA_ASCII.height * scale,           // scaled
  chars: VANILLA_ASCII.chars,
}
```

Pour H ∈ {4, 8, 12, 16, 20, 24, 32}, scale ∈ {0.5, 1, 1.5, 2, 2.5, 3, 4}. Les heights vanilla actuels (probablement tous pairs) × ces scales restent entiers ; si une multiplication produit un float, on `Math.round` (à valider via tests).

L'ascent reste inchangé : le top du glyphe est positionné par ascent uniquement ; height n'étend le glyphe que vers le bas. Le top du texte reste donc à chest-y Y peu importe la taille — comportement intuitif pour l'utilisateur.

### Coût

- **Taille du zip** : +~600KB JSON (vanilla `ascii.png` réutilisée, 0 texture supplémentaire).
- **Temps de bake** : ×7 sur cette étape (1400 vs 200 fichiers). Négligeable face au reste du build.

## Plugin

### `TitleCompiler.kt`

- Wrap : `<font:artisan:text_y${clampedY}_h${H}>$colored</font>` (et idem pour textarea). H = `layer.size ?: 8`.
- Width estimation : multiplier `estimateTextWidth(content)` par `H / 8.0` (Double pour préserver précision sur les scales fractionnaires, puis `.toInt()`).
- Clamp Y : pas de changement (même range [-32, 172]).
- Suppression de l'ancien format `text_y${Y}` sans suffixe `_h` : le plugin n'émet plus que la nouvelle forme. Les `text_y{Y}.json` sans size deviennent obsolètes et sont retirés du bake.

### `MenuTitleParser`

Ajoute `size: Int?` au parsing des layers Text et Textarea ; valide qu'il est ∈ {4, 8, 12, 16, 20, 24, 32} sinon fallback à 8 (lenient, pour absorber un YAML mal formé sans casser le menu entier).

## Éditeur

### `LayerEditForm`

- Pour Text et Textarea : ajouter un dropdown "Taille" avec 7 options :
  | Valeur | Label |
  |---|---|
  | 4 | Très petit (4) |
  | 8 | Normal (8) |
  | 12 | Moyen (12) |
  | 16 | Grand (16) |
  | 20 | Très grand (20) |
  | 24 | Énorme (24) |
  | 32 | Géant (32) |
- Default sélectionné : Normal (8). Stocké `undefined` dans le layer si = 8 (compactness).
- Masqué quand `fontAssetId` est défini (avec un texte explicatif court : « La taille suit la font importée »).

### Textarea — bouton "Aligner lineHeight"

Quand l'utilisateur change la `size`, son `lineHeight` ne s'ajuste PAS automatiquement (le user a peut-être réglé un spacing voulu). À côté du champ `lineHeight`, un bouton "Aligner à la taille" qui set `lineHeight = size + 2` en un clic. Pas auto.

### Canvas — preview pixel-perfect

`VanillaMcText` (et `TextAreaText` pour textarea) acceptent un prop `size: number` (default 8) et multiplient le scale Konva du glyph par `size / 8`. Le word-wrap (textarea, `wrapLine.ts`) recalcule les advances avec le même scale pour rester WYSIWYG avec le plugin.

## Tests

| Fichier | Cas |
|---|---|
| `backend/src/lib/fontJsonBuilder.test.ts` | (1) `buildTextYFontJson(0, 8)` retourne le JSON actuel (régression) ; (2) `buildTextYFontJson(0, 16)` double tous les `height` ; (3) `buildTextYFontJson(0, 4)` divise par 2. |
| `backend/src/lib/resourcePackBuilder.test.ts` | matrice 200 × 7 = 1400 fichiers `text_y{Y}_h{H}.json` ; sample un (Y=10, H=16) et vérifie le contenu. |
| `plugin/src/test/.../TitleCompilerTest.kt` | (1) text default → `text_y{Y}_h8` ; (2) text size=16 → `text_y{Y}_h16` ; (3) width estimate scale par H/8 ; (4) textarea avec size=12 → toutes les lignes wrappées dans le bon font tag. |
| `plugin/src/test/.../MenuTitleParserTest.kt` | (1) parse `size: 16` ; (2) size invalide (10) tombe sur fallback 8 ; (3) absence de `size` → null/default. |
| `editor/src/.../LayerEditForm.test.tsx` | (1) dropdown apparaît pour text + textarea ; (2) sélection écrit `size` ; (3) masqué si `fontAssetId` set ; (4) bouton "Aligner lineHeight" set `lineHeight = size + 2`. |
| `editor/src/.../VanillaMcText.test.tsx` | preview scale par size/8. |
| `editor/src/.../wrapLine.test.ts` | wrap recalcule les advances scaled. |
| `editor/src/features/export/transform.test.ts` | YAML émet `size: N` si ≠ 8 ; omet sinon. |
| `backend/src/lib/packImport.test.ts` | YAML avec `size` → field présent ; sans → undefined. |

## Risques / limites

- **Scale factor non-entier (0.5, 1.5, 2.5)** : si un provider vanilla a un height impair, le scale produit du float. Solution : `Math.round`. Devra être vérifié en test sur les 3 providers (ASCII, accented, non-latin) — actions correctives au cas par cas si le rounding visuel saute.
- **Bake size augmente** : ~700KB de JSON. Si plus tard on veut ajouter d'autres axes (ex: ligature, slant), la matrice explose. Pas de problème immédiat.
- **Sub-pixel positioning** : l'`x` d'un layer reste en pixels chest. Pour une taille H, un texte de N caractères occupe `N × char_advance × H/8` px. La table d'offsets (space provider) reste à granularité 1px — pas de quartier-pixel. Acceptable visuellement.
- **Compatibility entre versions du resource pack et du plugin** : pendant une transition (vieux plugin, nouveau RP), le plugin tente de référencer `text_y{Y}` (sans `_h`) qui n'existe plus → missing glyph squares. Atténué par le fait qu'on déploie plugin + backend ensemble (workflow `./gradlew deploy` rebuild les deux).

## Hors scope

- Size sur `fontAssetId` custom fonts.
- Non-uniform scaling (width ≠ height).
- Sizes < 4, > 32, ou non-multiples de 4.
- Editeur "manage sizes" globalement / par-pack — pas de presets utilisateur, le set est codé en dur.
- Application aux Element titles/lores dans l'inventaire (scope = title layers uniquement).
