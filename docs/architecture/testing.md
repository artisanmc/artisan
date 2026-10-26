# Tests — coverage by layer

Areas covered, not a file list — `glob **/*Test.kt` / `**/*.test.*` gives the exact list.
There has been no backend suite since phase F (2026-10).

| Layer | Run | Areas covered |
|---|---|---|
| Plugin `core` | `cd plugin && ./gradlew :core:test` | Action language, expressions and templates, YAML parsers, Project reading, drafts and publish journal (`ProjectPublisherRecoveryTest`), snapshot hash, conformance vectors. |
| Plugin `hub` | `./gradlew :hub:test` | Web server (link session, permissions, same origin, port in use), routes inherited from the backend (`EditorApiTest`), `/ws/plugin` (secret, protocol version, link requested by a leaf, offline server), vanilla catalog and textures. |
| Plugin `runtime` | `./gradlew :artisan-runtime:test` | Action engine and conditions without the plugin (`ConditionEvaluatorTest`, `ContextBinderTest`, `TemplateScopeTest`, `ModuleConditionsTest`), items and custom items, translations (`TranslationsTest`, `LangManagerTest`), `environment.yml` and pool (`PooledDatabaseTest`), scheduler, navigation history, package DAG. MockBukkit without `ArtisanPlugin`. |
| Plugin `paper` | `./gradlew :paper:test` | Menu rendering (MockBukkit), packet contract (`MenuSlotsContractTest`), protocol handlers (`Project*ChannelTest`, `ConfigChannelTest`, live fetch), `LocalServerLink`, `WsClient` (MockWebServer), resource pack (manager, delegation), network secret, the engine tests that load `ArtisanPlugin` (`ActionExecutorTest`, `ActionRegistryDispatchTest`, navigation). |
| Plugin `api`, `database` | `./gradlew test` | Java-friendly surface (`ApiSurfaceIsJavaFriendlyTest`), connection pools. |
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
| `testdata/lore-wrap-conformance.json` | `LoreWrapConformanceTest` (plugin) + `loreWrap.test.ts` (editor) |
| `testdata/document-layout-conformance.json` | `DocumentLayoutConformanceTest` (plugin, `model/DocumentLayout.kt`) + `domain/documentLayout.test.ts` (editor): where a module's Documents live (thematic folders, id = file name, errors `duplicate_id`, `kind_dir_subfolder`, `reserved_folder`, `invalid_folder`, `too_deep`) |
| `testdata/doc-ref-conformance.json` | `DocRefConformanceTest` (plugin) + `domain/docRef.test.ts` (editor) |
| `testdata/element-structural-keys.json` | `ElementStructuralKeysTest` (plugin) + `schema/elementStructuralKeys.test.ts` (editor) |
| `testdata/i18n-address-conformance.json` | `I18nAddressConformanceTest` (plugin) + `i18nAddressConformance.test.ts` (editor). The `step_addresses` cases give a legacy DSL string (`dsl`) or keyed `steps` (structured wire, module actions included) with the `declared_actions` they use: the addressing of action texts is driven by each action's schema (`assignI18nAddresses(steps, prefix, schemaOf)` on the plugin side, `walkStepTextSlots` on the editor side) — legacy slot per argument (`message`, `show_title`, `show_subtitle`), otherwise `<prefix>.<action>.<arg>` numbered by occurrence, text lists in `_2`, `_3`… |
| `testdata/core-actions.json` | `CoreActionsVectorTest` (core): generated from `CoreActions.kt` (`declared_actions` + `i18n_slots` shape), regenerated by `ARTISAN_WRITE_VECTORS=1`. The editor **imports** this file as the core actions table (`lib/actions/coreActions.ts`): it carries no hand-written copy of it. |
| `testdata/project-snapshot-hash-conformance.json` | `ProjectSnapshotHashConformanceTest` (plugin only: the editor does not recompute the hash) |
| `testdata/resource-pack-conformance.json` | `lib/pack/resourcePackConformance.test.ts` (editor): zip byte for byte. The editor's pack builder now owns it — the backend script that generated it went away with the backend; an intended change to the zip updates the vector's `entries`/`sha1` in the same commit. The SHA-1 does not depend on the host's time zone: the fixed date of the zip entries is built in local time (`ZIP_MTIME`, `resourcePackBuilder.ts`), because fflate writes the DOS timestamp from the `Date`'s local fields. |

## Packet menus — manual checklist

Menu content exists only on the client side (see `invariants.md`): the plugin tests lock
the contract (`MenuSlotsContractTest`, fake `ClientSlotSink`) but not the behavior of the real
Minecraft client. No automated client bot (Mineflayer ruled out: costly, and unavailable when a
new Minecraft version ships, precisely when the risk is there).

**Triggers**: a Minecraft or PacketEvents update, any change to
`PacketEventsMenuPackets.kt` / `MenuWindows.kt` / `MenuSlots.kt`. Also in the release checklist
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
- [ ] With the PacketEvents plugin installed alongside (relocated copy + standalone plugin): startup
  without errors and everything above holds.
