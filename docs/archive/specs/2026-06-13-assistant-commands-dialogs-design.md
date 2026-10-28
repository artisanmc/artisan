# AI assistant — command and dialog support

**Date**: 2026-06-13
**Status**: in review

## Problem

The AI assistant migrates menus (zMenu/DeluxeMenus → `menu/v1`) but **can neither create nor edit commands and dialogs**: it has no tool for that. Concrete reported consequence: an imported config gives "more or less" correct menus, but its commands and dialogs are lost.

Current state (asymmetry):

| Layer | Menus | Commands | Dialogs |
|---|---|---|---|
| Tools (`tools.ts`) | `list/get/upsert/delete_menu` | — | `list_dialogs` (read-only) |
| WorkingCopy | full menus | absent | summaries `{id,title}` |
| Validation (`validate.ts`) | `validateMenuV1` | — | — |
| Grounding | menu/v1 guide | — | — |
| Editor (apply) | `applyAssistantMenu` + `menuV1ToDomain` | — | — |
| Flow (`AssistantChat`→`routes`) | menus sent | not sent | summaries only |

The `command/v1` and `dialog/v1` schemas are **already published** (`docs/schema/`), reference the `$defs/Action` and `$defs/Condition` of `menu/v1`, and the domain→wire export pipeline (`transform.ts`) already knows how to serialize commands and dialogs. What is missing is the full loop on the assistant side + the wire→domain import on the editor side.

## Goal

The assistant can **create, read, replace and delete** commands and dialogs, exactly as it does for menus, with live application on the canvas and immediate persistence. The scope of actions/conditions stays the runtime subset already applied to menus (`SUPPORTED_ACTIONS` / `SUPPORTED_CONDITIONS` in `grounding.ts`).

## Decisions

| Topic | Decision |
|---|---|
| Scope | Commands **and** dialogs, full CRUD for both. Exact mirror of the menu pipeline. |
| Delivery split | A single feature (one spec + one plan), executed in two task batches (commands, then dialogs) for coherent commits. |
| Actions/conditions vocab | Reuses the existing `SUPPORTED_ACTIONS` / `SUPPORTED_CONDITIONS`. The vocab walker (`collectVocabErrors`) is generalized to cover a command's `actions`/`requirements`/`fallback` and the dialog buttons' `actions`. |
| Serialization for sending | Export `serializeCommand` / `serializeDialog` (private in `transform.ts` today) + add `packToCommandV1(pack)` / `packToDialogV1(pack)` (mirror of `packToMenuV1`). |
| Wire→domain converters | New `commandV1ToDomain.ts` / `dialogV1ToDomain.ts` in `editor/src/schema/`, reusing the action converter of `menuV1ToDomain.ts` (extracted into a shared module `actionV1ToDomain.ts`). |
| `list_dialogs` | Kept. The WorkingCopy goes from summaries to **full** dialogs; `list_dialogs` keeps returning `{id,title}` (derived summary), `get_dialog` returns the full object. |
| i18n | Wire commands/dialogs carry literal text / `{i18n:key}` like menus. The converters reuse the same i18n extraction logic as `menuV1ToDomain`. |

## Design

### Backend `backend/src/modules/assistant/`

**`validate.ts`** — add:
- `validateCommandV1(cmd)`: ajv against `command/v1/schema.json` (which `$ref`s the `Action`/`Condition` of menu/v1 — the ajv instance must load the menu/v1 schema as a referenced schema) + vocab walker on `actions`, `requirements`, `fallback`.
- `validateDialogV1(dlg)`: ajv against `dialog/v1/schema.json` + vocab walker on each button's `actions`.
- Generalize `collectVocabErrors`: extract the reusable `condition`/`action`/`steps` helpers (commands use flat `actions` + `requirements` + `fallback`; dialogs flat `buttons[].actions`).

**`tools.ts`** — new `ToolDef`s + cases:
- Commands: `list_commands`, `get_command`, `upsert_command`, `delete_command`.
- Dialogs: `get_dialog`, `upsert_dialog`, `delete_dialog` (`list_dialogs` already exists).
- Extend `EngineEvent`: `command_written`/`command_deleted`/`dialog_written`/`dialog_deleted`.

**`workingCopy.ts`** — add `commands` and `dialogs` maps (full objects, not summaries). `listDialogs()` derives the `{id,title}` summary. Extended constructor: `(menus, attachments, dialogs, commands)`.

**`grounding.ts`** + 2 sheets:
- `grounding/command-v1-authoring-guide.md`, `grounding/dialog-v1-authoring-guide.md`.
- `buildSystemPrompt` includes them. Anti-injection: mention that commands and dialogs are also produced exclusively via tools.

**`routes.ts`** — the body of `POST .../messages` receives `commands` (full command/v1 objects); `dialogs` goes from summaries to full dialog/v1 objects. WorkingCopy rebuilt with the 4 collections.

### Editor `editor/src/`

**`schema/actionV1ToDomain.ts`** (new) — extract the wire→domain action converter currently internal to `menuV1ToDomain.ts` (`action(a)`), to share it. `menuV1ToDomain` imports it (refactor with no behavior change, covered by its existing tests).

**`schema/commandV1ToDomain.ts`** (new) — `commandV1ToDomain(cmd, {packId, lang})` → `{ command: Command, i18nKeys, unsupported }`. Maps wire `actions: Action[]` → domain `steps: Step[]` (each action wrapped `{kind:"action", action}`); `arguments` → `CommandArg[]`; extracts i18n from the texts.

**`schema/dialogV1ToDomain.ts`** (new) — `dialogV1ToDomain(dlg, {packId, lang})` → `{ dialog: Dialog, i18nKeys, unsupported }`. Maps `body`/`inputs`/`buttons`; `buttons[].actions` → `steps`.

**`state/accountStore.ts`** — `applyAssistantCommand` / `applyAssistantDialog` (mirror of `applyAssistantMenu`: converts, merges i18n, insert/replace, `updatedAt`). Return the `unsupported`.

**`features/export/transform.ts`** — export `serializeCommand` / `serializeDialog` + add `packToCommandV1(pack)` / `packToDialogV1(pack)`.

**`features/assistant/AssistantChat.tsx`** — collect and send `commands` (via `packToCommandV1`) + full dialogs (via `packToDialogV1`, replaces the summaries). Handle the 4 new events (apply + UI card + `dirty`). Reuse the same `unsupportedDropped` toast.

**`lib/api/assistant.ts`** — `streamAssistant` body: add `commands?`, widen `dialogs?` to the full object type.

## Out of scope

- Templates, data sources, assets (the assistant does not touch them).
- Fine multi-turn editing of `if` steps in commands beyond what the vocab already allows.
- Conversational model / provider (unchanged).
- New action/condition types (the runtime subset stays frozen).

## Tests

- **Backend**: `validate.test.ts` (valid command/dialog + vocab rejections + unsupported fields); `tools.test.ts` (each new tool: success, missing id, validation failure → error message, events emitted); `workingCopy` (commands/dialogs CRUD, `listDialogs` derives the summary).
- **Editor**: `commandV1ToDomain.test.ts` + `dialogV1ToDomain.test.ts` (round-trip via `serializeCommand`/`serializeDialog`, i18n extraction, unsupported); `accountStore.test.ts` (`applyAssistantCommand`/`applyAssistantDialog` insert+replace+i18n); `transform` (packToCommandV1/packToDialogV1); `AssistantChat.test.tsx` (command/dialog events → apply called).
- Full suites green on both sides (`bun run test`, `npm test`).

## Docs to update

- `CHANGELOG.md` `[Unreleased]` (assistant surface + tools).
- `docs-site` — assistant page if it describes the capabilities (to check; otherwise a note in the existing assistant doc).
- The 2 grounding sheets are produced artifacts, not docs to synchronize.
