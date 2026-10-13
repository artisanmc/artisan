# minecraft-assets

Generators for the vanilla Minecraft data the repository commits, once per game version.
Self-contained Bun package: `bun install` here, nothing else (gen-icons also needs Node and the
`node_modules` of `editor/`).

The Mojang client jar is downloaded into `mc-assets/<version>/` (ignored by git) on the first
`gen-items.ts` run.

## Scripts

| Script | Produces |
|---|---|
| `gen-items.ts [version]` | `items/<version>.json`: the item catalogue (flat texture, or a `model` path for 3D blocks). |
| `gen-icons.ts [version]` | Renders every item with a `model` to PNG (Playwright + Three.js via `renderer-browser.ts` / `renderer-worker.mjs`) into `mc-assets/<version>/textures/icons/`, then rewrites `items/<version>.json` to point at those icons. |
| `pack-icons.ts [version...]` | `icons/icons-<version>.zip`: the rendered icons + the final catalogue. |
| `gen-char-advances.ts [version]` | Vanilla glyph width tables: `plugin/core/.../render/CharAdvances.kt`, `editor/src/features/canvas/title/charAdvances.ts`, `charCells.ts`, `editor/src/lib/pack/vanillaFontChars.ts`. |
| `gen-vanilla-font-zip.ts [version]` | `test-fonts/vanilla-ascii-<version>.zip`, a test MCFonts font built from `ascii.png`. |

## New Minecraft version

```bash
cd tools/minecraft-assets
bun gen-items.ts 1.21.x
bun gen-icons.ts 1.21.x
bun pack-icons.ts 1.21.x
bun gen-char-advances.ts 1.21.x   # if the vanilla font changed
```

Commit `items/<version>.json` and `icons/icons-<version>.zip`. The hub embeds them in its jar
(`plugin/hub/build.gradle.kts`: the catalogue always, the icons with `-PwithEditor`).
