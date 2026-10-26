# Project-qualified Document references — `project:id`

**Status:** accepted (2026-10-02)

## Context

The plugin stored menus and dialogs in a single table indexed by bare id, with no
notion of project: with two projects defining `main`, the last one loaded silently won,
and an `open_menu main` opened one or the other depending on load order. The editor, for
its part, refused to guess (an "ambiguous" link not drawn on the general board). The two
sides therefore did not see the same graph, and nothing made it possible to explicitly
target another project's menu.

The editor stays organized **by project** (draft, conflicts, publication); it now reads
all the server's projects (server index). A project keeps a meaning of its own —
namespace, default language, translations: it is not just a folder.

## Decision

1. **A project's namespace is its folder on the server's disk.** A qualified reference
   is written `<folder>:<id>` (`boutique:main`). `:` can appear neither in a project
   folder name (refused by the plugin) nor in a file name on Windows.
2. **Lexical resolution of a bare id**: first in the project of the referencing
   Document (clicked menu, command, dialog), then on the server if it is defined only
   once there. No existing file changes: all earlier links are local or unique.
3. **Ambiguity** (bare id absent from the project, defined by several others): the
   plugin opens **the last one loaded**, exactly as before, and says so once in the log;
   the editor does not draw the link and the deploy review warns. No menu that opened
   stops opening.
4. **The project travels with execution**: `ExecutionContext.projectId`, set by the
   command (`PackCommand`), by the opening of a menu or dialog (clicks resolve in *its*
   project) and by module actions. The navigation history reopens `projectId:id`, never
   a namesake.
5. **One algorithm, two implementations**: `resolveDocRef`
   (`editor/src/domain/docRef.ts`) and `DocumentTable` (plugin), locked by
   `testdata/doc-ref-conformance.json`.

## Out of scope

- **Command names**: registered by Bukkit server-wide, they are not Document
  references. Two projects claiming `/craft` remain in conflict; the deploy review
  shows it.
- ~~**Text DSL** (`action-dsl`): its grammar does not accept `:` in an identifier and
  is not extended.~~ Since 2026-10 the lexer reads `<folder>:<id>` as a single word
  (`open_menu boutique:main`, folder with hyphens or digits included), on both sides and
  in `testdata/action-dsl-conformance.json`. The editor always writes the structured
  format (`structured-action-wire`), where `open_menu: boutique:main` is a plain
  string.
## Editor

- The target selectors of `open_menu` / `open_dialog` list, under the name of each
  other project of the server (server index, published state), its menus and dialogs;
  choosing them writes the qualified form. A qualified target is displayed with its
  title and offers the remote menu's context inputs.
- Following a qualified reference (link badge in focus view) opens the project it names
  (`documentDestination`).

## Consequences

- Id duplicates between projects no longer change what opens from the project that
  defines the id; they are still reported, since a call *without* a project
  (`/artisan menu main`, API) remains ambiguous.
- `/artisan menu boutique:main` and `MenuProvider.findMenu(ref, fromProject)` accept
  the qualified form.
