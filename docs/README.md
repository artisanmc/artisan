# Artisan docs: where to look

Two audiences, two places:

- **Server admins and add-on developers** read `docs/site/` (published at artisanmc.net/wiki).
- **Contributors and agents** read the rest of `docs/`, below.

The code wins over any doc. A doc that contradicts the code is a bug: fix the doc in the same PR.

## By question

| You want to know… | Open |
|---|---|
| What a word means (Project, Document, Draft, Leaf…) | `CONTEXT.md` (root) |
| Why it is built this way | `decisions/<topic>.md` (ADRs) |
| What must never break (disk, CAS, `.artisan*`, threads) | `architecture/invariants.md` |
| How a module is built (plugin + editor layers, data sources, commands, kinds) | `architecture/modules.md` |
| What an add-on may import, and how stable it is | `architecture/api-surface.md` |
| What is stored where (server disk, suite database, hub memory) | `architecture/entities.md` |
| The layout of a Project on disk, `lang/`, `title` | `architecture/project-files.md` |
| The action chain format (`- message: "Hi"`) | `architecture/action-steps.md` |
| A REST route of the hub | `architecture/rest-endpoints.md` (then the `*Routes.kt` it names) |
| A WebSocket message (hub ↔ server, editor) | `architecture/ws-protocol.md` |
| How an editor screen is put together | `architecture/editor-internals.md` |
| The `/artisan` subcommands | `architecture/plugin-commands.md` |
| How a server is linked to a site account, updated and given new modules from the editor | `decisions/site-account-and-module-updates.md` (then `SiteAccount`, `SiteRoutes`, `updates/ModuleInstaller`) |
| How statistics are declared, buffered, stored and read | `decisions/stats-foundation.md` (then `plugin/stats`, `StatsRows`, `StatsRoutes`) |
| How player metrics reach a website (rankings, profiles), and the push protocol a website implements | `decisions/stats-export.md` (then `StatsExport`, `MetricRows`, `StatsExportHost`) |
| How a module imports another plugin's data (dry run, batches, rollback, `/artisan import`) | `decisions/data-imports.md` (then `ImportRegistry`, `ImportRuns`, `ImportRunRows`) |
| Where an image lives (a module's, common to the server), how a menu names it, what a theme is | `decisions/common-images-and-themes.md` (decided, not built yet; today's code: `decisions/mcp-server.md`, decisions 12 to 16) |
| The one rule that finds an image (module, the server's themes, the base), the Resources screen as a tree, Save as | `decisions/resources-one-screen.md` (accepted 2026-11-26, not built; amends `common-images-and-themes`) |
| How a button is made of several pieces (background, icon, labels), drawn at any width, and shared as a component | `decisions/element-parts-and-sliced-images.md` (proposed, not built; today: `image` and `label` of `schema/menu/v1/`) |
| Schema versions, protocol version, changelog rules | `architecture/versioning.md`, `changelog.d/README.md` |
| The JSON schema of a Document kind | `schema/<kind>/v1/` (+ `architecture/schemas-codegen.md`) |
| What the tests cover, conformance vectors | `architecture/testing.md` |
| How to file or triage a ticket | `agents/` |

## Which doc to update after a change

`.claude/skills/sync-docs/doc-impact-map.yaml` maps each source path to the docs it affects.

## `archive/`

Specs and maps from before the hub (April to October 2026): the cloud backend, the V1 roadmap,
an editor map from May. They explain old choices; they do not describe the current code. Do not
cite them as the current behavior.
