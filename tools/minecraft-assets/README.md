# minecraft-assets

Générateurs des données Minecraft vanilla que le dépôt commite, une fois par version du jeu.
Paquet Bun autonome : `bun install` ici, rien d'autre (gen-icons a aussi besoin de Node et des
`node_modules` de `editor/`).

Le jar client Mojang est téléchargé dans `mc-assets/<version>/` (ignoré par git) au premier
`gen-items.ts`.

## Scripts

| Script | Produit |
|---|---|
| `gen-items.ts [version]` | `items/<version>.json` : le catalogue d'items (texture plate, ou chemin de `model` pour les blocs 3D). |
| `gen-icons.ts [version]` | Rend chaque item à `model` en PNG (Playwright + Three.js via `renderer-browser.ts` / `renderer-worker.mjs`) dans `mc-assets/<version>/textures/icons/`, puis réécrit `items/<version>.json` pour pointer vers ces icônes. |
| `pack-icons.ts [version...]` | `icons/icons-<version>.zip` : les icônes rendues + le catalogue final. |
| `gen-char-advances.ts [version]` | Tables de largeur des glyphes vanilla : `plugin/core/.../render/CharAdvances.kt`, `editor/src/features/canvas/title/charAdvances.ts`, `charCells.ts`, `editor/src/lib/pack/vanillaFontChars.ts`. |
| `gen-vanilla-font-zip.ts [version]` | `test-fonts/vanilla-ascii-<version>.zip`, une police MCFonts de test tirée d'`ascii.png`. |

## Nouvelle version de Minecraft

```bash
cd tools/minecraft-assets
bun gen-items.ts 1.21.x
bun gen-icons.ts 1.21.x
bun pack-icons.ts 1.21.x
bun gen-char-advances.ts 1.21.x   # si la police vanilla a changé
```

Committer `items/<version>.json` et `icons/icons-<version>.zip`. Le hub les embarque dans son jar
(`plugin/hub/build.gradle.kts` : le catalogue toujours, les icônes avec `-PwithEditor`).
