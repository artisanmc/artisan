# Extensible Document kinds — module kinds, with actions and trigger sources

**Status:** proposed (2026-10-14) — grill decisions integrated.

## Context

Today a **Document** is a **closed** union of three kinds — Menu, Command,
Dialog — hard-wired through the whole stack:

- editor: `DocumentKind = "menu" | "command" | "dialog"`
  (`editor/src/features/canvas/serverGraph.ts:6`), a `DocumentType` that duplicates
  the union (`editor/src/features/project/useProjectDocuments.ts:8`), a
  `SearchGroup` that duplicates it again, repeated `KINDS` lists
  (`ServerCanvasPage.tsx:33`, `boardFilter.ts:14`), a `GUTTER_KIND_ORDER` order
  (`arrangeBoard.ts:43`), and a `Project` with three fields `menus/commands/dialogs`
  (`editor/src/domain/types.ts:134`);
- plugin: a `ProjectBundle` with three fields (`ProjectBundle.kt:538`), three separate
  parse blocks in `ProjectReader.kt:170-215`, two `DocumentTable`s
  (`menuTable`/`dialogTable`, `SyncedMenuProvider.kt:84-100`);
- wire: `docs/schema/menu/v1/schema.json` `$defs.Action` enumerates the core actions.

A module can already declare **data sources**, **commands**, **data models**,
**config screens**, its **project root**, **placeholders** — but **not** a
Document kind. We want to add kinds at the same level as
menus/commands/dialogs: **NPC**, **Quests**, **Conversations**.

**The grill's finding (2026-10-14) — the "kind navigable via `open_*`" lens is
wrong.** A Document kind brings three **independent** things:

1. **its content** — a disk folder, a versioned schema, an editor surface,
   i18n key sites, creation/renaming;
2. **Actions** — units invocable from an Action chain. Not all are
   `open_*`: a **Quest** is `start_quest`ed, `complete_quest`ed; a
   **Conversation** is `open_conversation`ed; an **NPC** is `spawn_npc`ed. `open_menu`
   is only **one** Action of a broader family;
3. **trigger sources** — a kind can be a **chain host**:
   an NPC that reacts to right click, a Conversation whose choices
   point elsewhere. This is what makes it a **source node** on the board,
   like an invoked Command or a clicked Element.

Three ADRs frame this:

- `structured-action-wire` (proposed): the canonical serialization of a chain is
  **structured, keyed by name** (`- send_message: "…"`, `- open_menu: {…}`), the DSL
  is **eliminated**. A module Action is therefore **a new key** in a map —
  extension is natural, no grammar to extend.
- `action-dsl` §Portability already prescribes a **table-driven** `parseVerb`
  ("universal core + host-registered verbs").
- `composable-data-models` §6 (and CONTEXT's "Data model" non-example): a
  Module declared **no** behavioral variant, module behavior went *only* through the
  `run_command ns:cmd` bridge. This ADR **revises** that position for Actions
  (see Decision 2/3), the bridge remaining for ad hoc cases.

## Decision

1. **A Document kind is authored content, registered by a module — the core
   dogfoods.** A kind = folder + `schemaVersion` + editor view + parse/serialize
   + creation/renaming + i18n key sites. The shipped kinds (menus, commands,
   dialogs) become the **first registrants** of the same interface, as the SDK
   barrel was adopted by the core modules. Target kinds: Menu, Command,
   Dialog, **Conversation**, **NPC**, **Quest**.

2. **An Action is extensible by modules, with core semantics.** The vocabulary
   stays **semantically core** (`give_item`, `send_message`, `if`/conditions,
   `open_menu`…). A module **declares** namespaced Actions (`quests:start`,
   `npcs:spawn`), each with a **typed argument schema**. `start_quest` and
   `quests:start` can be the same thing: a declared Action, dispatched to the
   module's handler.

3. **A single type system; `document_ref(kind)` is the only new argument type.**
   An Action's argument schema reuses the data models' type vocabulary
   (`material`, `item`, `minimessage`, `actions`, `enum`, `list`,
   `object`… — the field kit of `captured-items-and-module-field-kit`), plus **one**
   new type: `document_ref(kind)`. It is what makes an argument a **resolved
   target** — picker, rename, dead-ref detection, cross-project, **edge**.
   CONTEXT already says "There is **one** type system" (*Data model* entry): we do
   not create a second vocabulary for actions.

4. **Core actions dogfood the registry.** `open_menu`, `open_dialog`,
   `close_menu`, `open_previous_menu`… are **declared Actions** of the
   menus/dialogs modules, same contract as `start_quest`. The codec, the board
   and the dispatch become **registry-driven** — no "if it's core, it's special in
   the vocabulary". Their handler semantics (history push,
   `clearContext`, `with k=v`) stay core code: that is **handler**, not an
   argument shape.

5. **Keyed wire + asymmetric tolerance.** Action names shipped in the core are
   enumerated in `$defs.Action` (**strict** validation); a module Action is
   accepted as a **map with an unknown key** (passthrough, **tolerated** by the schema) and
   validated *in the form* by its declared argument schema — consistent with
   `composable-data-models` (blocking in the form, tolerant at runtime). No
   dynamic JSON schema.

6. **`run_command ns:cmd` remains the opaque escape hatch — outside the graph.**
   The raw command has no typed argument: the editor does not resolve it, draws no
   edge, does not rewrite its ids on rename. Explicitly accepted (grill): whoever
   writes `run_command quests:start mq_01` does not get the link.

7. **Ref resolution: what exists is reused.** `resolveDocRef`
   (`editor/src/domain/docRef.ts`) and `DocumentTable<T>` (plugin) are **already
   generic** and locked by `testdata/doc-ref-conformance.json`. A target kind
   **registers**; the algorithm and the vector **do not change** (kind-agnostic
   resolution). `SyncedMenuProvider` holds a `Map<kind, DocumentTable>`.

8. **Trigger sources = named chain slots.** A kind declares its
   **chain slots** through a **visitor** (same shape as the existing
   `ltextSites`/`visit*LTexts` visitors — a flat declarative path does not capture
   the menu's nested collections). A **trigger** is a named chain slot
   that is an **entry point**: `right_click`/`left_click` for an NPC, `invoke`
   for a Command, `click` for an Element. The board derives a source node from it.

9. **Board = core defaults + edges derived from types.** The core provides a
   generic node (box + label + default size) and **infers edges
   generically from `document_ref` arguments** — **no per-kind extractor**. A
   kind **may** override size/rendering/gutter rank, is never required to. The
   core kinds dogfood the same path.

10. **The Project model generalizes to a per-kind container** (editor + plugin).
    A folder of an **unknown** kind (uninstalled module) **round-trips as preserved
    opaque** — never deleted: a corollary of the invariant "everything lives on the
    server's disk". `projectFromFiles.ts` `CORE_PREFIXES` must list the kind
    dirs, otherwise their files are swallowed into `moduleData.__files`.

11. **Presence.** Declared kinds are reported in `hello`/`modules_changed`
    (`document_kinds`), like `declared_models`/`editor_screens`: module absent →
    kind **greyed out**, opaque folder (see 10).

12. **NPC and Conversation (semantics).** An **NPC** = one document = **one entity at
    a position** (like classic NPC plugins). Its interactions are **discrete**
    triggers (v1: `right_click`, `left_click`). A **Conversation**
    is a kind **distinct** from **Dialog**: a tree of lines and **choices**
    guarded by conditions, opened by `open_conversation <ref>`, potentially by
    several NPCs. **Proximity** is **not** a trigger — it is a continuous state
    (zone/tick), **deferred**.

13. **SemVer.** `DocumentKindDeclaration` (and its Action/trigger subtypes) is born
    **`@Beta`**: we open an extension point, we only freeze what we show.

## Questions settled in the grill (2026-10-14)

| # | Question | Settled |
|---|---|---|
| Q1/Q2 | First-class verb vs bridge; argument vocabulary | Declared keyed Actions; **one** type system, `document_ref(kind)` the only new type; `run_command` opaque |
| Q3 | `open_menu` special or not | **No** — core actions dogfood the registry |
| Q4 | NPC blueprint vs entity | **Entity** — one document = one position |
| Q5 | Dialog vs Conversation | **Distinct kinds** — Conversation = tree with choices |
| Q6 | What the kind owes the board | **Defaults + edges derived from `document_ref`** + optional override |
| Q7 | Where a kind's chains live | **Visitor** (like `ltextSites`); trigger = named slot |
| Q8 | Proximity as an NPC trigger | **No** — deferred (zone mechanism) |

## Consequences

- **Generalization work** documented in
  `docs/archive/specs/2026-10-14-extensible-document-kinds-design.md`: moving the
  core kinds through the registry **with no behavior change**,
  locked by `action-dsl-conformance.json` (or its successor), `doc-ref-
  conformance.json` and the existing suites, **before** opening registration.
- **CONTEXT.md** (updated 2026-10-14): term **Action** added; term
  **Conversation** added; "a Document kind" replaces "one of the three kinds"
  (Document/Command/Dialog). *NPC* and *Quest* remain to be defined once their model
  has been grilled.
- **Revision** of `composable-data-models` §6: module Actions are
  first-class, no longer only the bridge.
- We freeze the `@Beta` descriptor and **do not open** a new plugin API until
  a pilot (NPC, Conversation or Quest) requires it.

## Revision 2026-10-15 — confrontation with the `v2` code

Facts that correct the text above (the code is authoritative):

- The keyed structured wire is **already** in production on both sides (the editor writes
  `stepsToStructured`, the plugin reads `KeyedStepParser`); `structured-action-wire` goes
  `accepted` the same day. The "if accepted in the meantime" condition of spec W1 drops;
  removing the DSL codec is cleanup off the critical path.
- The cross-stack lock for the keyed wire did not exist: `testdata/action-wire-conformance.json`
  (`ActionWireConformanceTest` ↔ `lib/actions/actionWireConformance.test.ts`) creates it.
  `action-dsl-conformance.json` only covers the legacy DSL.
- The real field kit (`ModelFieldType`, `editor/src/domain/types.ts`) is `string, number,
  integer, boolean, ltext, minimessage, minimessage_multiline, item, actions, conditions, list,
  object, model, map, enum, union`. `material` is not part of it (it is `item`).
- The editor store is split by kind (`state/account/{menus,dialogs,commands,…}Slice.ts`,
  issue #46): the `file:line` map of spec W5 is refreshed accordingly.
- Two hard-coded sites were missing from the spec: `project/ResourceInventory.kt` (the three
  folders) and the hub's presence relay (`hub/RemoteServer.kt`, list of the fields copied
  from a leaf — `document_kinds` must be added there).

### Open questions (to settle before the "action registry" batch)

| # | Question | Recommendation |
|---|---|---|
| R1 | Decision 4: should core actions be **executed** through the registry, or only **described** by it? | **Settled (Iban, 2026-10-15): executed too.** A single contract `ActionHandler { name, args: ModelField[], execute(ctx, args) }`, implemented by each module; the core dispatches by name and knows nobody. `open_menu` is a handler of the menus module as `start_quest` will be of the quests module; no `when`/`if (name === …)` outside a handler. Compiler exhaustiveness is replaced by a **completeness test** (every vocabulary name has exactly one handler, whose schema matches) and by the `action-wire-conformance.json` vector; typing stays **internal to the module** (the `Action` sealed class becomes private to menus/dialogs). Same mechanism as `DataSourceRegistry`, `CommandRegistry`, `ModelRegistry`, `EditorScreenRegistry`. Two contract details imposed by the current code: (a) `execute` **returns the next context** — eight core actions modify it (`open_previous_menu`, `pagination_*`, `set_arg*`, `run_actions`) and `open_menu`/`open_dialog` push the navigation history; `run_actions` needs the runtime (run steps, resolve a text), so the handler receives `(ctx, args, runtime)`. (b) The scalar wire form (`open_menu: shop`) requires a **primary argument** in the declaration: the core normalizes `scalar → {primary: v}`, `null → {}`, `map → map` according to the schema, and canonicalizes the other way (only the primary set → scalar, no arg → bare name); the handler never sees the wire form. |
| R2 | Decision 10: per-kind container **right away**, or a `documentsOf(project, kind)` accessor over the old fields first, full container only if the accessor is not enough? | **Settled (Iban, 2026-10-15): a single container, now, whole.** The number of touched sites does not enter the balance: we decide on architecture health. `project.documents[kind]` / `ProjectBundle.documents` is the **single source of truth**; `documentsOf(project, kind)` and its typed variants are a **read facade**, not a second representation. The three parallel fields `menus/commands/dialogs` are the **root cause** of the problem: because the Project is modeled as three fields, the closed list of kinds leaks into every consumer (`DocumentKind` in twelve places, `["menu","command","dialog"]`, `GUTTER_KIND_ORDER`). The container removes the cause; an accessor over the old fields treated the symptom while keeping two representations and a migration to pay twice. The static typing lost only covered the core kinds, which the compiler cannot know anyway as soon as a kind comes from a module. Consequence on ordering: the container (W2) is the **base** of the work and goes first, as the 2026-10-14 handoff said. Caveat: the new contracts stay `@Beta` and only freeze after a pilot. **Done (batch 2)**: editor `domain/documentKinds.ts` (registry: kind, dir, idPrefix, schemaVersion, rank), `Project.documents: Record<kind, Document[]>`, facade `domain/documents.ts`, per-kind codecs `schema/documentCodecs.ts` driving `projectFromFiles` and `transform`; plugin `model/DocumentKinds.kt`, `ProjectBundle.documents: Map<kind, List<BundleDocument>>` with `menus/commands/dialogs` as typed getters (a single cast point), `ProjectReader` looping over the registry, `ResourceInventory` and the `SyncedMenuProvider` tables per kind. A project persisted before the container is folded on read (`lib/projectDocumentsMigration.ts`). |
| R3 | `document_ref(kind)`: a separate argument type, or a **kind of `ModelFieldType`**? | **Kind of `ModelFieldType`.** `ActionDecl.args` becomes a `ModelField[]`, `<SchemaForm>` already renders it, and a data model row can point to a Document with picker, rename, dead ref and edge through the same visitor. The only reading consistent with "a single type system". |
| R4 | Who declares the `quest` kind: Artisan core or **MSQuests as an add-on**? | **MSQuests.** The ADR declares kinds per module; the Quest pilot then lives in its repository and settles `quest/v1` there. |
| R5 | W5 and the remaining batches of #46 (one store per slice) overlap. | W5 after #46, or "generic per-kind Document CRUD" folded into the #46 plan. **Done (batch 5)**: W5 arrived after the slice split of #46; the generic CRUD is one more slice (`state/account/documentsSlice.ts`). |

### Public API language (settled 2026-10-15)

`plugin/api` is currently in Kotlin (28 files, Java interop annotations, `kotlin-stdlib`
in the POM). The add-ons that will plug into Artisan (MSQuests first) are in Java, and a
Kotlin contract consumed from Java exposes artifacts that make no sense to them
(`Companion`, `Unit`, `Function1` lambdas, invisible default parameters). Decision (Iban):
**`plugin/api` is rewritten in Java** — interfaces, records, enums, no dependency on the
Kotlin stdlib — and published as **API 2.0.0**; the internals (`core`, `database`, `hub`, `paper`) stay in
Kotlin. The timing: **between batch 2 (container) and batch 3 (actions by contract)**, so that
`ActionHandler`, `DocumentKind` and the W6 descriptors are born directly in their
final language instead of being written twice. The batch 2 `@Beta` surfaces on the `core` side
(`DocumentKinds`, `BundleDocument`) are not exposed to the api before this rewrite.

**Done (2026-10-15, API 2.0.0)**: `plugin/api/src/main/java`, 45 files. Chosen forms:
interfaces with Java getters (`getId()`), immutable final classes with `equals` rather than
`record`s — a `record` exposes `ref()` where Bukkit and all the plugin's Kotlin code read `getRef()` /
`decl.ref`; this way no Kotlin read site changes, only the implementers (`override fun
getId()`) and the named-argument constructions. `ArtisanAPI` is built through an `@Internal`
`Builder`. Nullability is annotated (`org.jetbrains.annotations.Nullable`). Removed as announced
by `@Sunset`: `ModuleMessagesApi`, `ArtisanAPI.messages`, `DataSourceDeclaration.schemaHint`.
`ApiSurfaceIsJavaFriendlyTest` now refuses any Kotlin class in the api's `src/main`.

**Done (2026-10-15, batch 3 — R1)**: every action goes through `ActionRegistry` (`plugin/api`, `@Beta`):
`ActionDeclaration(name, args: ModelField[], primary?, handler)`, `ActionHandler.execute(ctx, args,
runtime) → ctx`, `ActionContext` (player, args, language, project, `withArgs`), `ActionRuntime` (`text`,
`run`, `warn`). `normalize` folds the three wire forms (bare, scalar, map) into an argument map,
`bind` adds the declared defaults, `canonical` writes the shortest form. The engine step is
generic (`Step.ActionStep(name, value, i18n)`); `core` no longer knows the vocabulary — its
codecs (DSL, `{type}`) emit keyed steps. The core actions are `CoreActions` schemas
(`core`, locked to the menu schema's `$defs.Action` by `CoreActionSchemaConformanceTest`) joined
to their handlers in `paper` (`CoreActionHandlers`), registered like a module's;
`open_menu` no longer has a special case. `ModelFieldType.documentRef(kind)` exists (R3); the editor
accepts it (`document_ref`) and renders it as an id. Presence: `declared_actions` (hello,
`modules_changed`, `GET …/actions`); the editor offers module actions in the step
selector, renders their form from the declaration and writes them as is (`{type: "module", name,
value}`). Accepted debts, cleared in batches 4 and 5: the core actions' forms remain hand-written
(W4); the legacy DSL's positional i18n addressing remains a per-name table in
`I18nAddresses`; module action texts are not yet i18n sites.

**Done (2026-10-15, batch 4 — i18n debts)**: addressing of action texts is driven by each action's
schema, on both sides, locked by `testdata/i18n-address-conformance.json`
(keyed `steps` cases and module actions with their `declared_actions`): `ActionSchema.i18nSlots`
carries the legacy slot of a text argument (`send_message`/`broadcast` → `message`, `show_title` →
`show_title`/`show_subtitle`, counter per slot), any other `ltext` argument is addressed under the
action's name (`<prefix>.quests.notify.text`, numbered per occurrence; a `list(ltext)` numbers its
entries `_2`, `_3`…), an absent optional text consumes nothing, an undeclared action has no
site. `assignI18nAddresses(steps, prefix, schemaOf)` no longer contains any action name (the DSL is
a core-only codec: `CoreActions::schema` by default). `testdata/core-actions.json` is generated
from `CoreActions` (`CoreActionsVectorTest`) and **imported** by the editor (`lib/actions/coreActions.ts`)
as the core actions table; `domain/actionTextSlots.ts` (`walkStepTextSlots`) is the editor
mirror of the addresser, `visitStepLTexts` is a fold of it. Module action texts are i18n sites:
adopted as `LText` nodes at their address when the declaration is known (project loading, or Presence
later — `adoptProjectActionTexts`), listed in the Translations panel,
edited per language in the form (`ModuleTextInput`), rewritten as field-local text on export.
The remaining debt (core action forms, W4) is cleared below.

**Done (2026-10-15, W4 — "full unification" settled by Iban)**: the editor's typed
`Action` union is removed. A domain action is `{ name, value }` — the wire name
and its canonical value, its texts as `LText` nodes at the `ltext` locations — core or module
without distinction; `{type: "module", name, value}` disappears. Every reader goes through the
declaration (`domain/actionArgs.ts`: `normalizeActionArgs`, `canonicalActionValue`,
`actionArgs`, `actionDocumentRefs`): the form (`ActionEditor` renders a `DeclaredActionForm`
from `CORE_ACTIONS` ∪ `declared_actions`, one widget per argument kind, a few overrides
per `<action>.<arg>` for comfort — material, sound, expression, iteration target — and raw
JSON for an undeclared action), the pseudocode, the text slots, and the board edges,
the clipboard, Document renaming and preview contexts, which read the `document_ref` arguments (R3)
instead of knowing `open_menu`. Canonical rule written by the editor (vector
`action-wire-conformance.json`): a required argument is always written (its declared
default fills it if missing — the menu/v1 schema requires `{material, count}`), an
optional argument absent or equal to its default is omitted, the primary alone is written
bare, no argument → `null` if the declaration has arguments, bare name otherwise. The legacy DSL keeps its
typed AST (`lib/actionDsl/ast.ts`, locked by `action-dsl-conformance.json`); `domainSteps.ts`
projects it to `{name, value}` and also serves to fold the typed form of a persisted project
(`i18nMigration.ts`). Adding a core action to the form is now done in
`CoreActions.kt` (no more two i18n labels); a module action has nothing to add.

Detail retained without debate: a chain slot is a **site** (`{ name, steps, path }`),
like `LTextSite`, not a mere name — the generic edge extractor needs the steps
and the path to keep the triggers the board displays.

**Done (2026-10-15, batch 5 — W5, editor side)**: the SDK's kind contract exists.
`FrontendModule.documents: DocumentKindContribution[]` (`kind`, `dir`, `schemaVersion`,
`idPrefix`, `label`, `icon`, `component`, `title`, `listByTitle`, `create`, `parse`, `serialize`,
`ltextSites`, `chainSlots`, `board{size, summary, render}`); the SDK registry refuses a kind
contributed twice. The host installs a contribution at module registration
(`lib/moduleDocumentKinds.ts` → kinds table, codecs, `domain/documentKindVisitors.ts` visitors)
and reads the rest through `documentKindContribution(kind)`: Properties panel (`selectionContext`
`{kind: "document"}`, `FlowCanvas` renders the `component`), listings and search,
creation (`NewDocumentDialog`), store (`documentsSlice`: `createDocument`, `updateDocument`,
`setDocumentId` which repoints the kind's `document_ref`s), texts (`visitProjectLTexts`,
`rekeyProject`, GC), edges (`chain` trigger), board (`DocumentGroup`, generic node with a
non-interactive `board.render` preview) and server board. The core kinds are declared through the same
interface (`src/modules/{menus,commands,dialogs}/*Kind.tsx`) — decision 1 upheld; the built-in
core editors remain the fallback when their modules are not registered. Settled with Iban
(thread "Canvas editing or focus view per type"): (1) the Properties panel shows the
`component` of any kind through the registry; (2) `board.render` is a preview only; (3)
in-place menu editing on the board is a documented core exception, not generalized.
W6 followed immediately, without a pilot (see below): the "wait for a pilot" argument
did not hold, menu, command and dialog already being three kinds that had to go through the same door.

**Done (2026-10-16, W6 — plugin side, API 2.1.0)**: the kind registry is in `plugin/api`.
`api.getDocumentKinds()` (`DocumentKindRegistry`, `@Beta`) receives
`DocumentKindDeclaration(kind, dir, schemaVersions, idPrefix)` in `onEnable`, withdrawn with the module; same
ownership semantics as `ActionRegistry`. The core kinds are registered through this same door
(`DocumentKinds.coreRegistry()`), and `DocumentKinds.kt` becomes a Kotlin facade bound to this registry:
`ProjectReader`, `ResourceInventory` and the provider tables did not change. A kind registered
without a core reader is read as `BundleRawDocument` (YAML mapping, `schema:` checked against the declared
labels, file name as id) and handed to the module by `ProjectContentApi.documents(projectId,
kind)`; what the Document does remains up to the module — Artisan dispatches nothing (decision 2 upheld).
Presence reports `document_kinds` (`hello` and `modules_changed`, `GET …/document-kinds`);
the editor loads it into `serverDocumentKindsStore` and flags a kind that the active server does not
list (group header in the tree, warning in `NewDocumentDialog`) — a server that
does not report the field (older plugin) triggers nothing. The protocol stays at `1.1` (additive field).

## Out of scope / deferred

- **The DSL**: eliminated by `structured-action-wire`; not reintroduced.
- **Proximity / zones**: distinct mechanism (continuous state), deferred.
- **A third-party kind without a module**: no "kind as data".
- **Internal model of a Quest / a Conversation** (objectives, rewards,
  nodes): to be grilled with the pilot, out of this ADR.
- **Redefining a core Action**: a module is namespaced, collision =
  error at registration.

## Amendment 2026-10-24: collections (SDK 1.9)

A kind can declare `collection: { labels, screen? }`: its Documents form a single container
in the project (the shop's catalog, whose categories are Documents). The editor
shows it off the board, through a sidebar entry and a page, and keeps its Documents at the root,
the only place where their module reads them. Reason: these Documents are data, with no link to or
from other Documents; on the board they were only isolated nodes, and a
themed folder hid them from the module without the editor flagging it. The collection has no file:
it is computed from the kind, and its settings live in the config screen it designates (`screen`).

## Amendment 2026-10-25: reorderable lists (SDK 1.10)

The SDK exposes `SortableList`, a host component (dnd-kit in the editor, nothing bundled in the bundle)
: a module view reorders its lists through a drag handle, by pointer or keyboard, with
the same gesture as the sidebar. Reason: the up/down arrow buttons cost one click per
place and each module redrew them; the gesture now lives in a single place.

## Amendment 2026-10-26: conditions and Document references (SDK 1.11)

The SDK exposes `ConditionsEditor` and `DocumentRefInput`, host components. A module view edits its
conditions (a quest's prerequisites, the condition of a conversation choice) with the editor's
condition list, in the file format `api.getConditions()` reads, and points at another Document with
the picker of `document_ref` arguments. Reason: without them, each module redrew a text or YAML
field for these two needs (MSQuests, ArtisanConversations). A condition the editor does not decode is
kept as written, never lost on edit.

## Amendment 2026-10-28: images in the resource pack (SDK 1.13)

A kind declares the images its files draw at a height (`pack.images`), and the pack builder gives each
(asset, rise) a font the plugin hands out through `api.getOverlay()` (API 2.20.0). Reason: a HUD in the
action bar (ArtisanConversations) needs its box and cursor above the hotbar, and only the pack can
raise an image there; the builder already reads the menus' files for their glyph placements, and the
kind is the only one that knows where its files keep their images. The kind reads the parsed file, not
the Document: the pack is built from the server's files, without the editor's codec.

### Addendum 2026-10-28: Artisan owns the slots, rises are signed

Two changes before 2.20.0 shipped, so that custom HUDs designed in Artisan (a scoreboard at the top
of the screen, a textured boss bar) use the same pieces. A rise is signed: a HUD under the boss bar
draws downwards, with the menus' `text_y` fonts for text and a negative ascent for images
(-166..128). And no module sends the action bar itself: it shows a named layer in a slot
(`OverlayApi.show`/`hide`, `Slot.ACTION_BAR` first), drawn from the centre of the screen with the
pen brought back there, and Artisan draws the slot's layers together by priority and resends them.
Two modules writing the action bar would otherwise erase each other every second. *Rejected:* one
module per slot, the highest priority hiding the others (a quest goal and a conversation can share
the bar side by side). Corners of the screen stay out of reach: the server does not know its width,
and anchoring there takes core shaders in the pack.

## Amendment 2026-10-29: the game's screen (SDK 1.14)

The SDK exposes `McScreen` and `McText`, host components, and the screen's geometry as pure
functions (`guiScale`, `mcScreenLayout`, `bossBarAt`…). A module previews what it draws in game
(a conversation's HUD, its pages in the chat) on the same screen as the editor's own previews, at
the window size and GUI scale the user picks, instead of each module drawing its own approximation.
The geometry is pure so that a module places its layers with it (the conversations HUD rises from
`actionBarTop`), and it is locked by `testdata/mc-screen-conformance.json`. It is the first step of
the editor's Play mode, a navigable preview built from the Documents without a game client.
*Rejected:* a screen per module (they would drift apart), and putting the geometry behind the host
(a module's tests could not run it).

## Amendment 2026-10-29: a wide Document page (SDK 1.15)

A kind sets `wide` when its view is laid out in columns: on the Document's own page, `DocumentView`
then gives it the whole width instead of the centred column a command's pseudocode reads best in.
The conversations of ArtisanConversations show a page beside the game's screen and the ways into
it; in a 1024 px column on a wide monitor both were cramped while the sides stayed empty.
*Rejected:* every module view at full width (a command's or a trigger's sentence reads worse
across 2000 px), and the module's CSS escaping the host's column (it would rest on the host's
class names).

## Amendment 2026-10-30: HUD layouts (API 2.21.0)

A HUD is a layout of layers kept in the module's files (`OverlayLayout`: `image`, `image_slot`,
`text`, `list`), and Artisan composes the frame (`OverlayApi.compose`), instead of each module
placing its pieces with `move` and `raise` in code. Reason: ArtisanConversations hard-coded its box,
text and choices (`HudLayout`), so a mode could not move them, and the editor needs one format to
let a user lay a HUD out with the mouse; the same layers serve the next HUDs (a scoreboard, a boss
bar) without a format per module. Positions count y downwards from the slot's text, as on the
editor's screen; a rise is `-y`. The module keeps what is its own: which named layers exist, what
fills them, the wrapping and typing of its text. The geometry has conformance vectors
(`testdata/overlay-layout-conformance.json`) so that the editor draws a layout where the server
does. *Rejected:* the layout as a Document kind of Artisan (a HUD belongs to the module's own
Document, a conversation mode); text wrapped by `compose` (a module types its text letter by letter
and cuts it into screens, which needs the rows itself).
