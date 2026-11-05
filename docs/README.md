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
