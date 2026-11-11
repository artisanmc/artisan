# Extensible Document kinds — design & split

**Status:** draft (2026-10-14, refreshed on 2026-10-15) — derives from ADR
`extensible-document-kinds`. Grill decisions (2026-10-14) integrated; raw material for
the build. On 2026-10-15 the `file:line` map was checked against the `v2` code (after
#48–#54); questions R1–R5 of the ADR (§Revision) are **open** and marked here.

## Goal

Let a module add **Document kinds** at the same level as
menus/commands/dialogs, each able to bring: its **content** (files,
schema, editor view, i18n), **Actions** (`start_quest`, `open_conversation`)
and **trigger sources** (interactions of an NPC, branches of a
Conversation).

## Non-goals

- Reintroducing the DSL (eliminated by `structured-action-wire`).
- A "kind in data" without a module.
- **Proximity / zones**: continuous state, distinct mechanism — deferred (grill Q8).
- The **internal model** of a Quest / a Conversation (objectives, rewards,
  nodes): grilled with the pilot, not here.

## The model

### Editor-side descriptor (`FrontendModule.documents?`)

Addition to the `FrontendModule` contract (`editor/packages/editor-sdk/src/contract/types.ts:14-43`),
exported by the barrel `editor/packages/editor-sdk/src/index.ts`:

```ts
interface DocumentKindContribution {
  kind: string;                    // "npc", "quest", "conversation"
  dir: string;                     // "npcs/", "quests/"
  schemaVersion: string;           // "npc/v1"
  label: { en: string; fr: string } | string; // i18n key
  icon: ComponentType;
  idPrefix: string;                // "npc_", "quest_"
  component: ComponentType;        // the kind's editing view
  create(seed?): Document;         // minting + seed
  relPath(id: string): string;     // dir/<id>.yaml
  parse(file, ctx): Document;      // file → domain
  serialize(doc, ctx): string;     // domain → file
  ltextSites(doc): LTextSite[];    // i18n key sites (rekey + GC)
  chainSlots(doc): ChainSlotSite[]; // where the chains live (cf. trigger)
  actions?: ActionDecl[];          // declared Actions (typed)
  board?: { size?; render?; rank? }; // board override — OPTIONAL
}

// A declared Action: a name + typed arguments. R3 (ADR): the args are
// `ModelField[]` of the existing field kit (`ModelFieldType`), `document_ref(kind)` being
// a kind of `ModelFieldType` that is added — not a separate argument vocabulary. It is
// `document_ref` that makes the argument a resolved target → picker + edge,
// generically (no board code), including from a data model row.
interface ActionDecl {
  name: string;                    // "start_quest", "open_conversation"
  args: ModelField[];              // field kit + { kind: "document_ref", of: kind }
}

// A trigger IS a named chain slot that is an entry point. The visitor
// yields SITES (like `LTextSite`): the generic edge extractor needs the
// steps and the path to keep the triggers the board displays (element +
// clickType, dialog button, command invocation…).
interface ChainSlotSite {
  name: string;                    // "right_click", "invoke", "click"
  steps: Step[];
  path: string;                    // path in the document, for rename/undo
  label?: string;                  // what the edge displays (material, button…)
}
```

The core kinds (menus, commands, dialogs) declare theirs via this same
contract → **dogfood**.

### Plugin-side descriptor (new `@Beta` surface)

New `DocumentKindRegistry` in `plugin/api`, modeled on `ModelRegistry`
(`plugin/api/.../modules/api/ModelRegistry.kt`) and `EditorScreenRegistry`:

```kotlin
api.documents.declare(DocumentKindDeclaration(
    kind = "npc",
    dir = "npcs",
    schemaVersion = "npc/v1",
    acceptedVersions = listOf("npc/v1"),
    parse = { text, ctx -> ... },                 // file → runtime document
    actions = listOf(ActionDecl("npcs:spawn") { player, args -> ... }),
    chainSlots = listOf("right_click", "left_click"),
))
```

Reported at `hello` / `modules_changed` under `document_kinds` (parallel of
`declared_models`, `editor_screens`).

## Strategy: generalize first, open next, prove at the end

The order is non-negotiable: **the dogfood refactor is a pure move of
wiring, locked by the existing vectors**. We only open registration
once the core kinds have gone through the registry with no
behavior change.

Order of the batches (2026-10-15, after R1 and R2): the **container (W2) first**, it is the base;
then the **action registry with per-handler dispatch (W1 + W3)**; then **`document_ref`
in `ModelFieldType` and the generic edges (W4)**; then listing/create/rename/i18n (W5);
then the public registration surfaces and presence (W6, `@Beta`); finally a pilot (W7)
before any API freeze.

## Workstreams

### W0 — ADR + spec (this document)

ADR `extensible-document-kinds` (proposed) + this spec. The ADR's questions
are settled in the grill ("Decisions made" table of the ADR).

### W1 — Actions: types, vocabulary, wire (both stacks + schema)

- **A single type system**: the argument schema reuses the real field kit
  (`ModelFieldType`, `editor/src/domain/types.ts`: `string, number, integer, boolean,
  ltext, minimessage, minimessage_multiline, item, actions, conditions, list, object, model,
  map, enum, union`) **plus** `document_ref(kind)` — the only new type, generic
  source of edges. R3: add it **to** `ModelFieldType`, not beside it.
- Wire: the core Action names stay enumerated in
  `docs/schema/menu/v1/schema.json` `$defs.Action` (l.975+, **strict** validation);
  add the **unknown-key map tolerance** (module Action, validated at the form).
  **Actual state (2026-10-15)**: the editor today turns an unknown key into
  `run_actions ""` (`structuredSteps.ts` `decodeAction` default — silent loss) and the
  plugin throws `IllegalArgumentException("Unknown action")` (`KeyedStepParser.parseAction`
  else). Both must become the `module(name, args)` passthrough.
- Editor: `editor/src/schema/actionV1ToDomain.ts:29-48` (`action()` switch
  `default → pushUnsupported`), `features/flow/defaults.ts:63-86` (`ACTION_TYPES`),
  `docs/schema/menu/v1/types.ts:397-420`, labels/pickers `features/flow/labels.ts:6,44`.
- **Dogfood**: `open_menu`/`open_dialog`/`close_menu`/`open_previous_menu`
  are **handlers** of the menus/dialogs module (R1 settled: `ActionHandler { name,
  args: ModelField[], primary?, execute(ctx, args, runtime): ctx }`); codec, form, picker,
  edges **and dispatch** driven by the registry, `Action` sealed class internal to the module. Completeness test:
  one handler per name of the vocabulary, matching schema. Additional lock:
  `i18n-address-conformance.json` — the i18n visitor of the args becomes schema-driven
  (`ltext` in `ModelField[]`, like `visitModelValueLTexts`) and must emit the **same
  addresses** as `visitStepLTexts` / `I18nAddresses.kt` for the core actions.
- `structured-action-wire` is **accepted** (2026-10-15): the keyed wire is in prod on
  both sides. The DSL codec (`editor/src/lib/actionDsl/*`, `plugin/core/.../actiondsl/*`)
  now only serves to read the old files; its removal is a separate cleanup.
- Vector: `testdata/action-wire-conformance.json` (created on 2026-10-15,
  `ActionWireConformanceTest` ↔ `lib/actions/actionWireConformance.test.ts`) locks
  the keyed wire; it gains a module Action fixture (unknown key → passthrough) with the
  batch that implements it.

### W2 — Project model (both sides) — **done (batch 2, 2026-10-15)**

R2 settled: **single container, now, whole**. `project.documents[kind]` (editor) and
`ProjectBundle.documents` (plugin) are the single source of truth; the fields
`menus/commands/dialogs` have disappeared from both models. `documentsOf(project, kind)` and the
typed accessors (`menusOf(project)`, `bundle.menus`) are a **read facade**, never a
second storage. Volume was not an argument: all the sites were converted.

Actual state:

- Editor: `domain/documentKinds.ts` (registry `DocumentKindDef {kind, dir, idPrefix?,
  schemaVersion, rank}`, `register/list/byDir`, the three core kinds registered at load);
  `Project.documents: Record<string, Document[]>` (`domain/types.ts`); facade `domain/documents.ts`
  (`documentsOf`, `mutableDocuments`, `menusOf/commandsOf/dialogsOf`, `mutable*`, `allDocuments`,
  `documentIds`, `findDocument`, `emptyDocuments`); per-kind codecs `schema/documentCodecs.ts`
  (`parse`/`serialize`, the three core registered): `projectFromFiles` loops over
  `listDocumentKinds()` (core prefixes derived from the `dir`s), `transform` writes `<dir>/<id>.yaml` through
  the kind's codec. `lib/projectDocumentsMigration.ts` folds a Project persisted before the
  container (`setAccount`, `importProject`). Writing: `mutableMenus(draft).push(...)` or
  `draft.documents.menu = ...` — the container is the store, the facade reads.
- Plugin: `model/DocumentKinds.kt` (`DocumentKind {kind, dir, schemaVersions}`, copy-on-write
  registry, `byDir`); `ProjectBundle.documents: Map<String, List<BundleDocument>>` with
  `menus/commands/dialogs` as getters typed by `documentsOf<T>(kind)` (the only cast point);
  `BundleDocument { id }` implemented by `BundleMenu`, `CommandYaml`, `BundleDialog`;
  `ProjectReader` loops over `DocumentKinds.all()` with one reader per core kind (a kind
  registered without a reader is left on disk); `ManifestYaml.files` becomes
  `Map<dir, List<String>>`; `ResourceInventory` and the `SyncedMenuProvider` tables
  (`Map<kind, DocumentTable<BundleDocument>>`) follow the registry.
- **Opaque preserved**: a folder of an unregistered kind round-trips in `moduleData.__files`
  on the editor side and is not read on the plugin side (`DocumentKindsTest`).
- Remaining for W6: the full descriptors (parse/serialize on the plugin side exposed to the api, kind
  declared by a module); the facade keeps its typed accessors for the core kinds.

### W3 — Ref resolution + runtime "do"

- Reuse `DocumentTable<T>`: `SyncedMenuProvider.kt:84-100` becomes a
  `Map<kind, DocumentTable>`; `resolveRef` (`:102-116`) already kind-parameterized.
- Runtime: `provider/MenuProvider.kt:15-28` → a dispatch per registered
  Action kind; `engine/ActionExecutor.kt:132-166,326-340` → registry dispatch;
  `engine/NavigationHistoryStore.kt` `Kind` enum → string.
- `testdata/doc-ref-conformance.json` **unchanged** (kind-agnostic algorithm).

### W4 — Board / canvas

- `features/canvas/serverGraph.ts:6,54-116`: `DocumentKind` union → `string` +
  registry; `addTarget` for the target kinds.
- **Generic edges**: `deriveEdges.ts:17-105` no longer has per-kind extractors —
  we scan the chains (via `chainSlots`) and emit an edge for **every
  `document_ref` argument**. It is `document_ref` (W1) that does the work.
- **Defaults + override**: generic node (box + label + size) and default
  gutter rank; the kind's `board?` overrides. `arrangeBoard.ts:43`
  `GUTTER_KIND_ORDER`, `menuLayout.ts:4,60`, `ServerCanvasPage.tsx:33,177-186,399-430`
  → registry.
- Cosmetic trap: synthetic nodes/frames forced to `kind: "menu"`
  (`arrangeBoard.ts:800-807`, `groupedBoard.ts:45-61,110-189`) — neutral kind.

### W5 — Listing / create / rename / delete / i18n

- Editor: `useProjectDocuments.ts:8-41`, `ProjectDocumentTree.tsx:24-113`,
  `ProjectSidebar.tsx:274-280` (`documentCount`), `searchIndex.ts:6,155`,
  `domain/canvasGroups.ts:4-8` (`liveDocumentIds`).
- Store (split by #46 part 2): `state/account/menusSlice.ts` (`createMenu`,
  `setMenuId`), `dialogsSlice.ts` (`createDialog`, `setDialogId`), `commandsSlice.ts`
  (`createCommand`, `setCommandId`), `projectsSlice.ts` (`deleteFromProject`), `i18nSlice.ts`
  (`rekeyProject`) → a generic "documents" slice (create/rename/delete/layout per kind
  via the registry), the kind slices keeping their own editing actions. R5: to
  coordinate with the remaining batches of #46.
- i18n: `lib/i18nKeys.ts:5-49`, `domain/i18nSites.ts:158-207,544` — the kind's
  `ltextSites` visitor (otherwise rekey/GC silently broken); `chainSlots` also
  serves for renaming the refs in the chains.
- `domain/ids.ts:28-31` + `New*Dialog.tsx` dialogs → per-kind minting.

### W6 — Registration surfaces

- Plugin: `api.documents.declare(...)` (`DocumentKindRegistry`), `ArtisanModule`
  hooks, `ArtisanPlugin.defaultModules()` (`:94-96`) dogfood.
- Editor: `FrontendModule.documents`, collection in
  `editor/packages/editor-sdk/src/contract/registry.ts:6-32`, dogfood in
  `editor/src/modules/menus/index.ts` / `commands/index.ts` + dialogs registered
  in `main.tsx:9-24`.
- Presence: `document_kinds` at `hello` and `modules_changed` (`WsClient.kt`,
  `SyncedMenuProvider.kt` server side) **and** in the list of fields the hub copies
  from a leaf (`plugin/hub/.../RemoteServer.kt`, `modules_changed`) — otherwise a kind declared
  on a leaf is invisible from the hub.

### W7 — Pilot kinds

R4 (open): the `quest` kind is declared by MSQuests as an add-on (recommended, it is the letter
of the ADR), so this pilot lives in its repo. Note on the order: Conversation tests navigation and
edges but its editor (tree) is the biggest UI surface; NPC tests the trigger-source with
a trivial form but its runtime (entity, interaction) is real Bukkit work. A linear
"Conversation v0" (list of choice nodes, no graphical editor) is enough to validate
the plumbing.

In order of least risk, as add-ons, end to end — the validation:

1. **Conversation** — **choice tree** kind (branches guarded by conditions),
   `open_conversation` target; validates navigation, edges, the chain
   visitor. Distinct from `Dialog`.
2. **Quest** — kind + domain Actions (`start_quest`, `complete_quest`);
   validates the typed declared Actions and the edges to a non-screen.
3. **NPC** — **entity at a position**, **discrete** triggers (`right_click`,
   `left_click`) opening e.g. a Conversation; validates the trigger
   source. **Proximity deferred.**

Each pilot settles the **internal model** of its kind (objectives, nodes, etc.).

## Validation

- Existing vectors **intact** after W1–W5 (pure refactor):
  `action-wire-conformance.json`, `action-dsl-conformance.json`, `doc-ref-conformance.json`,
  `menuV1.test`, `menuV1ToDomain.roundtrip`.
- New tests: round-trip of an unknown kind dir (opaque preserved); a keyed
  module Action → edge derived from the `document_ref`; resolution of a
  module-kind ref; execution of a declared Action.
- `./gradlew test` (plugin) + `npm test` (editor) green at each workstream.

## Risks

- **Huge churn on `Project`/`ProjectBundle`** (W2): the deepest. To do
  first, behind the vectors, before any API opening.
- **Static wire schema**: resolved by the unknown-key map tolerance (W1) —
  check that `validateMenuV1` stays strict on the core Actions.
- **Uninstalled module**: the "opaque preserved" test is the safeguard.
- **SemVer inflation**: only freeze the `@Beta` descriptor.

## Decisions made (grill 2026-10-14)

See the eponymous table of ADR `extensible-document-kinds`: declared keyed
Actions + `document_ref(kind)` as the only new type; core dogfood; `open_menu` not
special; NPC = entity at a position; Conversation ≠ Dialog (choice tree);
board = defaults + edges derived from the types; chains declared by visitor;
proximity not a trigger (deferred).
