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
| `gen-char-advances.ts [version]` | Vanilla glyph width tables: `plugin/core/.../render/CharAdvances.kt`, `editor/src/lib/mcFont/charAdvances.ts`, `charCells.ts`, `editor/src/lib/pack/vanillaFontChars.ts`. |
| `gen-padded-fonts.ts [version]` | `editor/src/assets/minecraft/font/{ascii,accented,nonlatin_european}_up.png`: the vanilla font textures with 128 transparent rows under each cell, for the rising fonts `artisan:text_up{R}` (Minecraft refuses an ascent above the height). |
| `gen-vanilla-font-zip.ts [version]` | `test-fonts/vanilla-ascii-<version>.zip`, a test MCFonts font built from `ascii.png`. |

## New Minecraft version

```bash
cd tools/minecraft-assets
bun gen-items.ts 1.21.x
bun gen-icons.ts 1.21.x
bun pack-icons.ts 1.21.x
bun gen-char-advances.ts 1.21.x   # if the vanilla font changed
bun gen-padded-fonts.ts 1.21.x    # idem
```

Commit `items/<version>.json` and `icons/icons-<version>.zip`. The jar embeds the catalogue and only
the SHA-256 of each icon zip (`plugin/hub/build.gradle.kts`); hubs download the zip itself from the pack
CDN (`https://cdn.artisanmc.net/vanilla/icons-<version>.zip`, `VanillaAssets`), so upload it before
releasing a jar that knows its hash:

```bash
cd deploy/pack-cdn-worker
npx wrangler r2 object put artisan-packs/vanilla/icons-<version>.zip --remote \
  --file ../../tools/minecraft-assets/icons/icons-<version>.zip
```

A zip changed after a release must keep its name and contents together: a hub whose hash differs
refuses it and shows flat textures. To render, Playwright needs its own Chromium; another one goes
through `CHROMIUM_PATH=/path/to/chromium`.
