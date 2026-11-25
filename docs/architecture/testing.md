# Tests — coverage by layer

Areas covered, not a file list — `glob **/*Test.kt` / `**/*.test.*` gives the exact list.
There has been no backend suite since phase F (2026-10).

| Layer | Run | Areas covered |
|---|---|---|
| Plugin `core` | `cd plugin && ./gradlew :core:test` | Action language, expressions and templates, YAML parsers, Project reading, drafts and publish journal (`ProjectPublisherRecoveryTest`), snapshot hash, conformance vectors. |
| Plugin `hub` | `./gradlew :hub:test` | Web server (link session, permissions, same origin, port in use), routes inherited from the backend (`EditorApiTest`), `/ws/plugin` (secret, protocol version, link requested by a leaf, offline server), vanilla catalog and textures. |
| Plugin `runtime` | `./gradlew :artisan-runtime:test` | Action engine and conditions without the plugin (`ConditionEvaluatorTest`, `ContextBinderTest`, `TemplateScopeTest`, `ModuleConditionsTest`), items and custom items, translations (`TranslationsTest`, `LangManagerTest`), `environment.yml` and pool (`PooledDatabaseTest`), scheduler, navigation history, package DAG. MockBukkit without `ArtisanPlugin`. |
| Plugin `paper` | `./gradlew :paper:test` | Menu rendering (MockBukkit), packet contract (`MenuSlotsContractTest`), protocol handlers (`Project*ChannelTest`, `ConfigChannelTest`, live fetch), `LocalServerLink`, `WsClient` (MockWebServer), resource pack (manager, delegation), network secret, the engine tests that load `ArtisanPlugin` (`ActionExecutorTest`, `ActionRegistryDispatchTest`, navigation, `VariablesExecutionTest`: Variables, typed arguments by template, `teleport` to a stored place, `chat_button`). |
| Plugin `api`, `database` | `./gradlew test` | Java-friendly surface (`ApiSurfaceIsJavaFriendlyTest`), connection pools, suite tables (`VariableRowsTest`: the newer write wins, purge). |
| Editor | `cd editor && npm test` | Expr DSL, canvas + Document editing, files ↔ domain codec (`schema/`, round trip per kind), export (validate/zip), i18n, title composer, resource pack in the browser (`lib/pack/`), drafts and conflicts, routes, a Document kind contributed by a module end to end (`lib/moduleDocumentKinds.test.tsx`: a "quest" kind goes through registries, selection, panel, listings, search, texts, edges, board and store). |
| Editor E2E | `cd editor && npm run test:e2e` | `smoke.spec.ts` — the app starts on `npm run dev`, API mocked to 401: an anonymous visitor lands on `/login`, with no page error. |

Static checks on the editor, in CI with the tests: `npm run typecheck` (`tsc -b`, tests
included; the build only types `tsconfig.app.json`), `npx biome lint .` on the whole editor, and the
Biome format on only the files changed by the PR (`biome format --changed`).

Editor → hub → server E2E: **not automated**, manual test on `docker compose` (single server)
or `docker/network/compose.yml` (hub + leaf).

## Conformance vectors

These shared vectors lock an equality between implementations (Kotlin ↔ TS). Changing
the algorithm = updating both sides **and** regenerating the vector.

| Vector | Enforced by |
|---|---|
| `testdata/action-wire-conformance.json` | `ActionWireConformanceTest` (plugin, `KeyedStepParser` + binding by `CoreActions`) + `lib/actions/actionWireConformance.test.ts` (editor, `structuredSteps.ts`): the keyed structured wire (ADR `structured-action-wire`). Each case gives a `wire` (accepted variant), its `canonical` form (what the editor writes) and the `names` of the head steps; both stacks must read `wire` and `canonical` as the same chain (binding by `CoreActions.bind`, numbers compared as doubles: `volume: 1` and the default `1.0` are the same value for a handler), and the editor must rewrite `canonical`: the shortest form (`domain/actionArgs.ts`, `canonicalActionValue`) — required argument always written (declared default if missing), optional argument at its default omitted, lone primary bare, `{name: null}` for a declaration with arguments where none is set, bare name with no declared argument. Module Actions go through as is (`quests:*`). |
| `docs/schema/menu/v1/schema.json` `$defs.Action` | `CoreActionSchemaConformanceTest` (core): every published action has exactly one `ActionSchema` in `CoreActions` (names, arguments, required, types, defaults), and none more; `ActionRegistryDispatchTest` (paper): the core handlers cover this vocabulary, a module action is bound and executed by the registry (ADR `extensible-document-kinds` R1). |
| `testdata/action-dsl-conformance.json`, `action-dsl-eval-conformance.json` | `ActionDslConformanceTest`, `LeafEvalConformanceTest` (plugin) + `lib/actionDsl/*.test.ts` (editor) — the legacy DSL, read but no longer written |
| `testdata/template-conformance.json` | `TemplateConformanceTest` (plugin) + `lib/expr/template/conformance.test.ts` (editor) |
| `testdata/lang-tree-conformance.json` | `LangFlattener` (plugin) + `langTree.ts` (editor) |
| `testdata/overlay-layout-conformance.json` | `OverlayLayoutConformanceTest` (plugin api, `OverlayLayout.read` + the placement behind `OverlayApi.compose`); the editor's port of the format reads it too: reading a HUD layout (problems by path and code, layers kept, pack images at their rise) and placing a frame (draws in order, x from the centre, rise of the top; widths `width_per_char` a character, image heights from `heights`) |
| `testdata/lore-wrap-conformance.json` | `LoreWrapConformanceTest` (plugin) + `loreWrap.test.ts` (editor) |
| `testdata/document-layout-conformance.json` | `DocumentLayoutConformanceTest` (plugin, `model/DocumentLayout.kt`) + `domain/documentLayout.test.ts` (editor): where a module's Documents live (thematic folders, id = file name, errors `duplicate_id`, `kind_dir_subfolder`, `reserved_folder`, `invalid_folder`, `too_deep`) |
| `testdata/doc-ref-conformance.json` | `DocRefConformanceTest` (plugin) + `domain/docRef.test.ts` (editor) |
| `testdata/image-ref-conformance.json` | `ImageNamesTest` (`plugin/pack`, the hub's builder), `ImageRefConformanceTest` (`plugin/core`, what the game looks up) + `lib/pack/imageNames.test.ts` (editor): which image a name in a module's file is when modules hold images of the same name, and when it is a common image (ADR `common-images-and-themes`, decision 3). `common`: the common images' names, told to a builder before any module's image is named. `ids`: the pack id of each module's image, the bare name for the first module by Project order when no common image has that name, `<folder>:<name>` otherwise; `also`: the common images in the pack (`kit:<name>`). `cases`: a name written in a module and the id it reaches, computed from the set of ids alone, so the game finds from the asset index the image the builder wrote. |
| `testdata/element-structural-keys.json` | `ElementStructuralKeysTest` (plugin) + `schema/elementStructuralKeys.test.ts` (editor) |
| `testdata/i18n-address-conformance.json` | `I18nAddressConformanceTest` (plugin) + `i18nAddressConformance.test.ts` (editor). The `step_addresses` cases give a legacy DSL string (`dsl`) or keyed `steps` (structured wire, module actions included) with the `declared_actions` they use: the addressing of action texts is driven by each action's schema (`assignI18nAddresses(steps, prefix, schemaOf)` on the plugin side, `walkStepTextSlots` on the editor side) — legacy slot per argument (`message`, `show_title`, `show_subtitle`), otherwise `<prefix>.<action>.<arg>` numbered by occurrence, text lists in `_2`, `_3`… |
| `testdata/core-actions.json` | `CoreActionsVectorTest` (core): generated from `CoreActions.kt` (`declared_actions` + `i18n_slots` shape), regenerated by `ARTISAN_WRITE_VECTORS=1`. The editor **imports** this file as the core actions table (`lib/actions/coreActions.ts`): it carries no hand-written copy of it. |
| `testdata/project-snapshot-hash-conformance.json` | `ProjectSnapshotHashConformanceTest` (plugin only: the editor does not recompute the hash) |
| `testdata/ramp-shades-conformance.json` | `lib/pack/ramps.test.ts` (editor) and `RampsTest` (`plugin/pack`): what each shade of a ramp of the base becomes when the ramp's main colour becomes `picked` (`rampTable`, `Ramps.table`), the shades that do not change left out. The editor's theme page and the MCP tool `theme_colours` must write the same table. Both tests also check that `editor/src/assets/kit/ramps.json` holds every colour of the base's images, each in one ramp. A change of the rule goes into both sides and the file. |
| `testdata/resource-pack-conformance.json` | `lib/pack/resourcePackConformance.test.ts` (editor) and `ResourcePackConformanceTest` (`plugin/pack`, the hub's Kotlin builder): zip byte for byte, plus the SHA-256 of each entry (`entryHashes`) so a drift names the file, and the text fonts of another size than 8 (`textYSized`, one per (Y, size) the menus' texts use). Inputs are the Projects' files and binaries and the module images their kinds ask for (`overlayImages`); the common images' base comes from the theme `artisan`'s `originals/` when the server holds it, else from each builder's own resources (`kit:<name>`, `Kit.kt` ↔ `kit.ts`; one case with the former `ui-kit` module, one with the theme: a bare name no module holds, `artisan:<name>`, `kit:<name>`, the base as the server holds it, a redraw at the base's size and one left out, the theme's own images out of the pack unless named); composed images (a descriptor's `compose:` list, `Compose.kt` ↔ `compose.ts`, one case, with the same unit cases in `ComposeTest` and `compose.test.ts`: reading a recipe, sizes, clipping, the blend); the kit's themes (`themes` on a case, the server's `resource-pack.themes`, the lowest first, or `theme`, the former single one; `Theme.kt` ↔ `theme.ts`, two cases: with one theme, colours replaced in the base and in the server's kit images that follow the ramps (one that does not keeping its own), an image the theme redraws, one of another size left out, a composed image following its themed layers once, a module's own image untouched; with several in place, each changing what the ones below show, the highest that redraws an image winning as drawn, colours above a drawing repainting it (a composed common image's drawing taken as drawn), a theme the server does not hold left out; with themes of their own folder, Projects of `role: "theme"` on a case, read from `overrides/colors.yml` and `overrides/artisan/<image>.png`, a theme's Project winning over the folder the common images keep for that name and never read as a module, the same stack giving the same pack in either place; with a theme's redraws of modules' images, `overrides/<module>/<image>.png`, each replacing that module's image at its size under the id it had, the highest theme that redraws it winning as drawn, a theme's colours leaving a module's image that does not follow the ramps, a module's composed image following its redrawn layer, a drawing of another size, deeper or of no module left out; with ramps and scope, a theme's colours repainting the images that follow the ramps (the base, a common image and a module's image whose descriptor says `ramps: true`, the owner's version of a shipped image through the shipped descriptor) and leaving the others, drawn by a theme or not, `scope` keeping a theme's colours to one module's images or to the common ones; the same unit cases in `ThemeTest` and `theme.test.ts`); a case with `bedrock: {serverId}` also locks the Bedrock pack (`bedrock/bedrockPack.ts` ↔ `Bedrock.kt`: entries, `entryHashes`, SHA-1), a Project's `folder` naming it as the plugin does (menu keys, and `<folder>:<name>` for an image whose module is not the first to hold that name: `ImageNames.kt` ↔ `imageNames.ts`, one case with two modules that each hold the same names, plus the rule's own vector `image-ref-conformance.json`). A Project's files include what its module ships (`originals/…`): the packs read them under the owner's, file for file (`shippedView.ts` ↔ `ShippedView`), for Documents and for assets. An original that declares a `function` is replaced at its measures only (`imageFunction.ts` ↔ `ImageFunctions` in `Assets.kt`, one case: a menu image and a HUD image measured by their pixels, a glyph by its height and ascent, the original and its descriptor showing otherwise, an original without a function replaced at any size; the same unit cases in `imageFunction.test.ts`). The editor's assembly (`lib/pack/packAssembly.ts`, shared by `buildServerPack`, this test and `npm run pack`) is the source; the Kotlin builder must produce the same bytes, and reads YAML as the editor does (1.2 core schema: `no` stays a string, `010` is ten), not as SnakeYAML or Jackson resolve it. An intended change to the zip regenerates the expected values with `cd editor && npm run pack -- vectors --write`, in the same commit. The Kotlin builder reads `vanilla-font-chars.json` and `symbol-glyphs.hex` from its jar, exported from `vanillaFontChars.ts` and `symbolGlyphs.ts` by `npm run pack -- kotlin-data`; the same test checks both copies. The SHA-1 does not depend on the host's time zone: the fixed date of the zip entries is built in local time (`ZIP_MTIME`, `resourcePackBuilder.ts`), because fflate writes the DOS timestamp from the `Date`'s local fields. |

## Packet menus — manual checklist

Menu content exists only on the client side (see `invariants.md`): the plugin tests lock
the contract (`MenuSlotsContractTest`, fake `ClientSlotSink`) but not the behavior of the real
Minecraft client. No automated client bot (Mineflayer ruled out: costly, and unavailable when a
new Minecraft version ships, precisely when the risk is there).

`MenuPacketInterceptorTest` covers the Netty handler on an `EmbeddedChannel` with a fake codec
(placement, rewrite, silent sends, a failing rewrite); the server's classes are only met in game.

**Triggers**: a Minecraft update, any change to `render/packets/` (`NmsMenuPackets.kt`,
`MenuPacketInterceptor.kt`, `MenuPacketRewriter.kt`, `MenuWindows.kt`) or `MenuSlots.kt`. Also in the release checklist
(`versioning.md` §11.1).

On `./gradlew deploy`, with a `player_inventory: hidden` menu that puts stone on all
positions (top and bottom) and a `visible` menu:

- [ ] Stone everywhere, top and bottom (`hidden`).
- [ ] Click, shift-click, double-click, number key, F key: nothing moves, nothing is picked up.
- [ ] Pick up an item from the ground with the menu open: the bottom stays the menu's.
- [ ] Go from menu A to menu B (`open_menu` button): B displays in full, with no leftover of A.
- [ ] Back: `A → B → C` then the `open_previous_menu` button twice brings back A (never back-and-forth C↔B); without history, the `{has_previous_menu}` placeholder is false and back does nothing.
- [ ] Closing: the real inventory comes back intact.
- [ ] `/data get entity @s Inventory` with the menu open = the real inventory (nothing server-side).
- [ ] `visible`: the real inventory displays and cannot be modified.
- [ ] `vanilla_texture: false`: transparent window (top and bottom), the menu's glyph displays, the
  items stay above the glyph.
- [ ] Same server: a real chest, a barrel, an ender chest and a double chest keep their
  vanilla texture (re-injected), title in place; same right after `/artisan reload`.
- [ ] Player who refuses the pack: normal vanilla chests, no missing character in the titles.
- [ ] Hopper and dropper menus with `vanilla_texture: false`: transparent windows; a real
  hopper, dispenser and dropper keep their texture (re-injected), a real chest is not
  touched as long as no chest menu is transparent.
- [ ] With ViaVersion + ViaBackwards and an older client, and with ProtocolLib or PacketEvents installed
  alongside: startup without errors and everything above holds.
- [ ] On Paper, Folia, Leaf and Spigot 26.x; Spigot 1.21.x refuses to start with its message.
