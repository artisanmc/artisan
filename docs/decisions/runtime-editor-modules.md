# Module views loaded at runtime — the jar carries its view

**Status:** accepted (2026-10-17). Batch L5 of ArtisanQuests, Artisan part (level 3 of
`auto-hebergement.md` §10).

## Context

Until now a module's editor view (`FrontendModule`) was compiled into the editor, hence
shipped by the suite's jar: fixing the quests view required an Artisan release, and a
server whose quests plugin is newer or older than the editor displayed a view that did
not match the plugin. Iban decided on 2026-10-16: the quests view is shipped **in the
ArtisanQuests jar**.

## Decisions

1. **The jar declares its bundle.** `api.getEditorBundles().register(EditorBundleDeclaration
   .fromResource(loader, "artisan-editor/ui.js", sdk))` (`@Beta`, API 2.3.0) from
   `onEnable`. Presence announces it in `installed_modules[].editor_bundle`
   (`{sdk, hash, size}`); the hub serves it on `GET /api/v1/servers/:server/modules/:module/ui.js`,
   relayed to the server (`editor_bundle_fetch`, protocol 1.2), checked against the
   announced SHA-256 and kept in memory by hash. Plugin detail: `modules.md` §4.6.
2. **Versioned SDK.** `@artisan/editor-sdk` carries `SDK_VERSION` (1.2.0). Same
   discipline as the Java API: major = an export changes meaning or disappears, minor =
   an addition. A bundle is loaded if its major is the editor's and its minor ≤ the
   editor's; otherwise it is refused before download (`older-editor`: update Artisan;
   `older-bundle`: update the module) and the editor falls back to the built-in copy if
   it has one.
3. **No import map, rewritten shared modules.** A bundle is **a single ES module**. Its
   only allowed imports are `react`, `react-dom`, `react/jsx-runtime` and
   `@artisan/editor-sdk` (`distribution/sharedModules.ts`): a single instance of React
   and of the SDK in the page, otherwise hooks break and the module registers in a
   registry the editor does not read. An import map can no longer be added once the
   editor has started, so the editor rewrites each specifier (`es-module-lexer`, asm.js
   build without WebAssembly) to a small module that re-exports its own instance, then
   imports the bundle from a `blob:` URL. Any other import (relative chunk, unshared
   package) is refused. *Rejected:* dynamic import map (not supported everywhere),
   isolated iframe (a module's JS has no more power than its jar, already installed by
   the admin).
4. **The SDK exposes the host, never its internals.** A view reads and writes through
   the SDK: `useProject`, `useContentLang`, `useUiLang`, `updateDocument` (Document +
   texts in a single undo step), `newTextKey`, `textValue`, `fieldText`, `projectLangs`,
   `notify`, and since 1.1 two editor widgets, `ActionChainEditor` (action chain in the
   file format) and `MaterialInput` (item palette), rendered by the host
   (`EditorHost.components`, `distribution/hostComponents.tsx`).
   The editor installs the implementation at startup (`lib/editorHost.ts`). A module
   carries its labels (`createModuleI18n`, a kind's `labels` per language) and its
   styles (`injectModuleStyles`, prefixed classes, colors through `var(--token)`): a
   bundle has not been scanned by the editor's Tailwind, it only relies on the design
   system classes (`.btn`, `.input`, `.select`, `.field-label`…).
5. **The bundle wins.** `modulesStore.integrate` loads the announced bundle (it matches
   the installed plugin exactly), otherwise the entry of `modules.manifest.ts` if there
   is one (a module compiled into the editor, like the shop); a module shipped by its
   jar has none. A module's failure only costs its view. `origins` and `refused` say
   where each view comes from and why a bundle was discarded.
6. **A kind registered after a Project is read loses nothing.** The view arrives with
   Presence, sometimes after the Project is read: its folder is then kept as is in
   `moduleData[<dir>].__files` (re-exported identically), then `adoptLateDocuments`
   reads it through the kind's codec as soon as the modules are ready.
7. **Building a bundle.** `artisanModuleBundle({ entry })` (`@artisan/editor-sdk/bundle`)
   gives the Vite config: ES lib, shared modules as externals, everything else inlined,
   and the build SDK version stamped on the default export (`sdk`), checked at load.

## Consequences

- Artisan does not own the view of a module shipped by its jar: the quests view (kind
  `quest_group`, Presence id `msquests`) lives in the MSQuests repository (`editor/`),
  which builds `ui.js` into its jar's resources. With no bundle served, the editor has
  no view for that module. `modules.manifest.ts` only keeps the modules compiled into
  the editor.
- A module outside the repository depends on the SDK through its archive (`npm pack` of
  `editor/packages/editor-sdk`) as long as `@artisan/editor-sdk` is not published on npm.
- Changing `SHARED_MODULES` or the `EditorHost` contract is a change to the SDK: minor
  for an addition, major otherwise.
- Out of scope: a group node containing its quests on the board, a counter of running
  instances (live), rewards as Artisan chains (L3).
