# Editions: free and Pro

Decision: `monetisation-artisan-2026-10-27.md` (project files). One code base, two jars.

## Build

| | Free | Pro |
|---|---|---|
| Gradle | `-Pedition=free` | `-Pedition=pro` (default: local builds and `deploy` stay Pro) |
| Jar | `artisan-plugin-<v>-free.jar` → released as `Artisan-<v>.jar` | `artisan-plugin-<v>-all.jar` → `Artisan-Pro-<v>.jar` |
| Marker | `artisan-edition.properties`: `edition=free` | `edition=pro` |

The hub module writes the marker (`hub/build.gradle.kts`, task `editionFile`); `Edition.bundled()`
reads it. A jar without it (test classpath, build older than editions) is Pro, and any value but
`free` is Pro: a mistake never removes features from a running server. The CI checks the marker
of each jar it builds (`plugin.yml`, `release-jars.yml`).

Same plugin name and data folder: switching edition is replacing the jar.

**Early access** (Pro): each push to `v2` or `main` touching the plugin or the editor builds
`<last v tag>-dev.<run>` and replaces the assets of the GitHub pre-release `dev`
(`release-jars.yml`). Those jars go to Pro buyers only; the free edition gets tagged releases.
A tag also publishes: the free jar to Modrinth and Hangar, the Pro jar to Voxel; SpigotMC and
BuiltByBit by hand (`deploy/README.md`, "Releasing the plugin").

Pro list (Iban, 2026-10-27): title composer, resource pack, image import, early access, priority
support, advanced expressions (editing only). Bedrock menus are not sold until finished.

## What the free jar gates

Only **editing**. Rendering is never gated.

| Pro feature | Free jar |
|---|---|
| Title composer (layers, positions, offsets) | Vanilla title only. A composed title is shown on the canvas and in the panel, read-only (`LayersPanel`, `TitleRender`). |
| Image, font and Nexo import | Buttons disabled with a Pro badge (`AssetsTab`); the picker offers no upload (`AssetPicker`). Existing assets stay pickable. |
| Advanced expressions (method, `+`/`-`, ternary; `lib/expr/advanced.ts`) | Help only (Iban, 2026-10-27): no readable view (`ExpressionRules` shows the raw `{…}` with a Pro badge, edited in the Code view) and no evaluated preview (`ExpressionPreview`). Typing, saving and publishing them stay free; `{x.y}`, PAPI and comparisons keep all the help. |
| Resource pack build and upload | The editor does not rebuild after a publish (`resourcePackSync`); the hub answers `PUT …/resource-pack` with 403 `pro_required` (`PackRoutes`). |

The editor learns the edition from `GET /api/v1/auth/me` (`user.edition`, `lib/edition.ts`);
absent means Pro.

## Rules

1. **A free jar never breaks content made with Pro.** The engine renders composed titles, image
   buttons and transparent windows the same; the hub keeps serving the packs it stored
   (`PackStore`, the last three) and the server keeps its cached pack (`ResourcePackManager`).
2. **What files or modules ship keeps working.** Gating is in the editor only, never at load or at
   run time (decided for advanced expressions as well, 2026-10-27).
3. **Content a module ships uses no Pro feature**: on a free server nobody could build the pack its
   glyphs need. `ProFeatures` (core) lists them: a `menus/*` title with a non-`plain` layer, a
   `vanilla_texture: false`, an image button, any file under `assets/`. Artisan logs a warning for
   each module template that uses one when it seeds templates; `ProFeaturesTest` covers the rules.
4. No DRM. A patched jar bypasses any local check; the paid jar is what is sold.

## Not done yet

- Glyph preview of a vanilla title with Nexo glyphs (read-only preview in free).
- A check module repositories can run in their own CI (today: the warning at start).
- The MCP endpoint and the assistant can still write a composed title in a free jar's draft; no
  pack is built for it.
