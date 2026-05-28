# Editor Dialog System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dialog creation/editing to the editor — `DialogId` type, `Dialog` domain type, canvas node (violet), `NewDialogDialog`, `DialogEditor` in FlowCanvas, full step editor for buttons, YAML export.

**Architecture:** Mirrors the command system: canvas `DialogGroup` → select → `FlowCanvas` routes to `DialogEditor` (inline editor for title, body, inputs, buttons). Buttons use the existing `Step[]` / pseudocode infrastructure. Export flattens button steps to flat `actions` list (no if-branches in v1, matching plugin's `DialogButtonYaml`).

**Tech Stack:** React 19, Vitest, Konva, Immer, Zustand, i18next, yaml (js-yaml/yaml pkg)

---

## File Map

| Action | File |
|---|---|
| Modify | `editor/src/domain/types.ts` |
| Modify | `editor/src/domain/ids.ts` |
| Modify | `editor/src/lib/i18nKeys.ts` |
| Modify | `editor/src/state/accountStore.ts` |
| Modify | `editor/src/state/accountStore.test.ts` |
| Modify | `editor/src/mock/fixtures.ts` |
| Modify | `editor/src/features/canvas/menuLayout.ts` |
| Create | `editor/src/features/canvas/DialogGroup.tsx` |
| Create | `editor/src/features/canvas/NewDialogDialog.tsx` |
| Modify | `editor/src/features/canvas/Stage.tsx` |
| Modify | `editor/src/features/canvas/ContextMenu.tsx` |
| Modify | `editor/src/features/flow/FlowCanvas.tsx` |
| Modify | `editor/src/features/flow/PseudocodeView.tsx` |
| Modify | `editor/src/features/export/transform.ts` |
| Modify | `editor/src/features/export/transform.test.ts` |
| Modify | `editor/src/locales/en.ts` |
| Modify | `editor/src/locales/fr.ts` |

---

## Task 1: Domain types + IDs

**Files:**
- Modify: `editor/src/domain/types.ts`
- Modify: `editor/src/domain/ids.ts`

- [ ] **Step 1: Write the failing test**

In `editor/src/state/accountStore.test.ts`, add at the top of the `describe` block:

```typescript
it("createDialog returns a DialogId and adds dialog to pack", () => {
  const dId = useAccountStore.getState().createDialog({
    packId: PERSONAL,
    id: "d_test",
  });
  const pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
  expect(pack.dialogs).toHaveLength(1);
  expect(pack.dialogs[0]!.id).toBe("d_test");
  expect(typeof dId).toBe("string");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd editor && npx vitest run src/state/accountStore.test.ts 2>&1 | head -40
```

Expected: compile error — `createDialog` does not exist, `dialogs` does not exist on Pack.

- [ ] **Step 3: Add `DialogId` + dialog domain types to `editor/src/domain/types.ts`**

After the `DataSourceId` line (line 22), add:
```typescript
export type DialogId = string & { __brand: "DialogId" };
```

Update `Pack.canvasLayout` type:
```typescript
canvasLayout: Record<MenuId | CommandId | DialogId, { x: number; y: number }>;
```

Add `dialogs` field to `Pack` (after `commands: Command[];`):
```typescript
dialogs: Dialog[];
```

Add `open_dialog` and `close_dialog` to the `Action` union (after `set_arg_cycle_prev`):
```typescript
| {
    type: "open_dialog";
    dialogId: DialogId;
    context?: Record<string, string>;
    clearContext?: boolean;
  }
| { type: "close_dialog" }
```

Add these interfaces at the end of the file (before the closing):
```typescript
export interface Dialog {
  id: DialogId;
  packId: PackId;
  title: LText;
  canCloseWithEscape: boolean;
  body: DialogBody[];
  inputs: DialogInput[];
  buttons: DialogButton[];
}

export type DialogBody =
  | { type: "text"; text: LText }
  | { type: "item"; material: string; count: number };

export type DialogInput =
  | { type: "text"; id: string; label: LText; default: string; maxLength: number }
  | { type: "bool"; id: string; label: LText; default: boolean }
  | {
      type: "number_range";
      id: string;
      label: LText;
      min: number;
      max: number;
      default: number;
    }
  | {
      type: "single_option";
      id: string;
      label: LText;
      options: DialogOption[];
      default: string;
    };

export interface DialogOption {
  value: string;
  label: LText;
}

export interface DialogButton {
  id: string;
  label: LText;
  steps: Step[];
}
```

- [ ] **Step 4: Add `dialogId` + `newDialogId` to `editor/src/domain/ids.ts`**

Add `DialogId` to the import at top:
```typescript
import type {
  AccountId,
  AssetId,
  CommandId,
  DialogId,
  ElementId,
  LayerId,
  MenuId,
  PackId,
  TemplateId,
} from "./types";
```

Add after `newCommandId`:
```typescript
export const dialogId = (s: string): DialogId => s as DialogId;
export const newDialogId = () => dialogId(`d_${next()}_${Date.now().toString(36)}`);
```

- [ ] **Step 5: Update `editor/src/mock/fixtures.ts`** to add `dialogs: []` to all pack objects (all three packs: `personalPack`, `shopSystemPack`, and the third pack). The `Pack` interface now requires `dialogs`.

```typescript
// In each pack return object, add:
dialogs: [],
```

- [ ] **Step 6: Run the test to verify it still compiles (but fails on createDialog missing)**

```bash
cd editor && npx vitest run src/state/accountStore.test.ts 2>&1 | head -40
```

Expected: compile error about `createDialog` not existing yet (not type errors on dialogs).

- [ ] **Step 7: Commit**

```bash
rtk git add editor/src/domain/types.ts editor/src/domain/ids.ts editor/src/mock/fixtures.ts
rtk git commit -m "feat(editor): DialogId type, Dialog domain type, Action open_dialog/close_dialog"
```

---

## Task 2: accountStore — dialog CRUD + step mutations

**Files:**
- Modify: `editor/src/state/accountStore.ts`
- Modify: `editor/src/lib/i18nKeys.ts`
- Modify: `editor/src/state/accountStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `editor/src/state/accountStore.test.ts`:

```typescript
it("createDialog with position sets canvasLayout", () => {
  useAccountStore.getState().createDialog({
    packId: PERSONAL,
    id: "d_shop",
    position: { x: 100, y: 200 },
  });
  const pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
  expect((pack.canvasLayout as Record<string, unknown>)["d_shop"]).toEqual({ x: 100, y: 200 });
});

it("setDialogTitle stores translation in i18nKeys", () => {
  useAccountStore.getState().createDialog({ packId: PERSONAL, id: "d_greet" });
  useAccountStore.getState().setDialogTitle({ packId: PERSONAL, dialogId: dialogId("d_greet"), lang: "en", value: "Hello!" });
  const pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
  const dialog = pack.dialogs.find((d) => d.id === "d_greet")!;
  expect(pack.i18nKeys[dialog.title.key]!["en"]).toBe("Hello!");
});

it("deleteFromPack removes dialog and its canvas position", () => {
  useAccountStore.getState().createDialog({ packId: PERSONAL, id: "d_bye", position: { x: 10, y: 10 } });
  useAccountStore.getState().deleteFromPack({ packId: PERSONAL, nodeIds: ["d_bye"] });
  const pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
  expect(pack.dialogs.some((d) => d.id === "d_bye")).toBe(false);
  expect((pack.canvasLayout as Record<string, unknown>)["d_bye"]).toBeUndefined();
});

it("addDialogButton appends a button with LText", () => {
  useAccountStore.getState().createDialog({ packId: PERSONAL, id: "d_multi" });
  useAccountStore.getState().addDialogButton({ packId: PERSONAL, dialogId: dialogId("d_multi") });
  const pack = useAccountStore.getState().account.packs.find((p) => p.id === PERSONAL)!;
  const d = pack.dialogs.find((d) => d.id === "d_multi")!;
  expect(d.buttons).toHaveLength(2); // default btn_confirm + new one
});
```

Also add the import at top of test file:
```typescript
import { dialogId, elementId, menuId, packId } from "@/domain/ids";
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd editor && npx vitest run src/state/accountStore.test.ts 2>&1 | head -60
```

Expected: compile errors about missing `createDialog`, `setDialogTitle`, `addDialogButton`, `dialogId` import.

- [ ] **Step 3: Add i18nKeys helpers for dialogs in `editor/src/lib/i18nKeys.ts`**

Add after `rekeyCommandLTexts`:

```typescript
export const dialogTitleKey = (dialogId: string): I18nKey =>
  `dialogs.${dialogId}.title` as I18nKey;

export const dialogBodyTextKey = (dialogId: string, index: number): I18nKey =>
  `dialogs.${dialogId}.body.${index}.text` as I18nKey;

export const dialogInputLabelKey = (dialogId: string, inputId: string): I18nKey =>
  `dialogs.${dialogId}.inputs.${inputId}.label` as I18nKey;

export const dialogOptionLabelKey = (dialogId: string, inputId: string, optionValue: string): I18nKey =>
  `dialogs.${dialogId}.inputs.${inputId}.options.${optionValue}.label` as I18nKey;

export const dialogButtonLabelKey = (dialogId: string, buttonId: string): I18nKey =>
  `dialogs.${dialogId}.buttons.${buttonId}.label` as I18nKey;

export const dialogButtonKeyPrefix = (dialogId: string, buttonId: string): string =>
  `dialogs.${dialogId}.buttons.${buttonId}`;
```

Also add `gcDialogLTexts` helper alongside `gcMenuLTexts` and `gcCommandLTexts` (these are likely already in accountStore.ts — add a parallel one). Actually this goes in accountStore.ts in Step 4.

- [ ] **Step 4: Add dialog CRUD actions to `editor/src/state/accountStore.ts`**

4a. Update imports at top of accountStore.ts — add to the `@/domain/ids` import:
```typescript
import {
  newAssetId,
  newCommandId,
  newDialogId,
  newElementId,
  newLayerId,
  newMenuId,
  newPackId,
} from "@/domain/ids";
```

Add `Dialog`, `DialogBody`, `DialogButton`, `DialogId`, `DialogInput`, `DialogOption` to the type imports:
```typescript
import type {
  Account,
  Action,
  Appearance,
  ClickType,
  Command,
  CommandArg,
  CommandId,
  Condition,
  ConnectorSpec,
  ContextInput,
  DataSource,
  DataSourceId,
  Dialog,
  DialogBody,
  DialogButton,
  DialogId,
  DialogInput,
  DialogOption,
  Element,
  ElementId,
  FieldType,
  LText,
  Layer,
  Menu,
  MenuId,
  Pack,
  PackId,
  SourceRef,
  Step,
} from "@/domain/types";
```

Add to the `@/lib/i18nKeys` import:
```typescript
import {
  clickHandlerKeyPrefix,
  commandKeyPrefix,
  dialogBodyTextKey,
  dialogButtonKeyPrefix,
  dialogButtonLabelKey,
  dialogInputLabelKey,
  dialogOptionLabelKey,
  dialogTitleKey,
  elementLoreKey,
  elementTitleKey,
  menuTitleKey,
  messageKeyAt,
  rekeyCommandLTexts,
  rekeyMenuLTexts,
} from "@/lib/i18nKeys";
```

4b. Add dialog actions to the `AccountState` interface (after `createCommand`):

```typescript
/** Create a new dialog with sensible defaults (1 button "btn_confirm", empty body/inputs). */
createDialog: (input: {
  packId: PackId;
  id: string;
  position?: { x: number; y: number };
}) => DialogId;
setDialogTitle: (input: { packId: PackId; dialogId: DialogId; lang: string; value: string }) => void;
setDialogField: (input: { packId: PackId; dialogId: DialogId; field: "canCloseWithEscape"; value: boolean }) => void;
/** Rename a dialog's id. Rejects if newId already exists in the pack. */
setDialogId: (input: { packId: PackId; oldId: DialogId; newId: DialogId }) => void;
addDialogBody: (input: { packId: PackId; dialogId: DialogId; body: DialogBody }) => void;
removeDialogBody: (input: { packId: PackId; dialogId: DialogId; index: number }) => void;
setDialogBodyText: (input: { packId: PackId; dialogId: DialogId; index: number; lang: string; value: string }) => void;
setDialogBodyMaterial: (input: { packId: PackId; dialogId: DialogId; index: number; material: string; count: number }) => void;
addDialogInput: (input: { packId: PackId; dialogId: DialogId; inputType: DialogInput["type"] }) => void;
removeDialogInput: (input: { packId: PackId; dialogId: DialogId; index: number }) => void;
setDialogInput: (input: { packId: PackId; dialogId: DialogId; index: number; patch: Partial<DialogInput> }) => void;
addDialogButton: (input: { packId: PackId; dialogId: DialogId }) => void;
removeDialogButton: (input: { packId: PackId; dialogId: DialogId; buttonIndex: number }) => void;
setDialogButtonLabel: (input: { packId: PackId; dialogId: DialogId; buttonIndex: number; lang: string; value: string }) => void;
addDialogButtonStep: (input: { packId: PackId; dialogId: DialogId; buttonIndex: number; frames: StepFrame[]; index: number; step: Step; lang: string }) => void;
moveDialogButtonStep: (input: { packId: PackId; dialogId: DialogId; buttonIndex: number; frames: StepFrame[]; fromIndex: number; toIndex: number }) => void;
setDialogButtonStep: (input: { packId: PackId; dialogId: DialogId; buttonIndex: number; path: StepPath; step: Step; lang: string }) => void;
removeDialogButtonStep: (input: { packId: PackId; dialogId: DialogId; buttonIndex: number; path: StepPath }) => void;
addDialogButtonIfCase: (input: { packId: PackId; dialogId: DialogId; buttonIndex: number; frames: StepFrame[]; ifStepIndex: number }) => void;
removeDialogButtonIfCase: (input: { packId: PackId; dialogId: DialogId; buttonIndex: number; frames: StepFrame[]; ifStepIndex: number; caseIndex: number }) => void;
setDialogButtonIfCaseConditions: (input: { packId: PackId; dialogId: DialogId; buttonIndex: number; frames: StepFrame[]; ifStepIndex: number; caseIndex: number; conditions: Condition[]; op?: "and" | "or" }) => void;
setDialogButtonIfCaseJoin: (input: { packId: PackId; dialogId: DialogId; buttonIndex: number; frames: StepFrame[]; ifStepIndex: number; caseIndex: number; joinIndex: number; op: "and" | "or" }) => void;
toggleDialogButtonIfElse: (input: { packId: PackId; dialogId: DialogId; buttonIndex: number; frames: StepFrame[]; ifStepIndex: number; lang: string }) => void;
```

4c. Add a `gcDialogLTexts` helper (alongside `gcMenuLTexts` and `gcCommandLTexts` in the file — typically near the bottom before the `useAccountStore` declaration):

```typescript
function gcDialogLTexts(pack: Pack, dialog: Dialog): void {
  const keys = new Set<string>();
  keys.add(dialog.title.key);
  for (const body of dialog.body) {
    if (body.type === "text") keys.add(body.text.key);
  }
  for (const input of dialog.inputs) {
    keys.add(input.label.key);
    if (input.type === "single_option") {
      for (const opt of input.options) keys.add(opt.label.key);
    }
  }
  for (const btn of dialog.buttons) {
    keys.add(btn.label.key);
    for (const action of walkActions(btn.steps)) {
      if (action.type === "send_message") keys.add(action.text.key);
    }
  }
  for (const key of keys) delete pack.i18nKeys[key as I18nKey];
}
```

4d. Update `deleteFromPack` to handle dialogs (add after `pack.commands = pack.commands.filter(...)`):

```typescript
for (const d of pack.dialogs) {
  if (ids.has(d.id)) gcDialogLTexts(pack, d);
}
pack.dialogs = pack.dialogs.filter((d) => !ids.has(d.id));
```

4e. Add the implementation of all dialog actions in the `create((set, get) => ({...}))` block (after `createCommand`):

```typescript
createDialog: ({ packId: pId, id, position }) => {
  const dId = id as DialogId;
  const titleKey = dialogTitleKey(id);
  const btnLabelKey = dialogButtonLabelKey(id, "btn_confirm");
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      if (!pack) return;
      pack.i18nKeys[titleKey] = { [pack.defaultLang]: "" };
      pack.i18nKeys[btnLabelKey] = { [pack.defaultLang]: "Confirm" };
      pack.dialogs.push({
        id: dId,
        packId: pId,
        title: { key: titleKey },
        canCloseWithEscape: true,
        body: [],
        inputs: [],
        buttons: [{ id: "btn_confirm", label: { key: btnLabelKey }, steps: [] }],
      });
      if (position) {
        (pack.canvasLayout as Record<string, { x: number; y: number }>)[id] = position;
      }
      pack.updatedAt = new Date().toISOString();
    }),
  );
  return dId;
},
setDialogTitle: ({ packId: pId, dialogId: dId, lang, value }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      if (!pack) return;
      const dialog = pack.dialogs.find((d) => d.id === dId);
      if (!dialog) return;
      if (!dialog.title) {
        const key = dialogTitleKey(dId);
        dialog.title = { key };
        pack.i18nKeys[key] = {};
      }
      if (!pack.i18nKeys[dialog.title.key]) pack.i18nKeys[dialog.title.key] = {};
      pack.i18nKeys[dialog.title.key]![lang] = value;
      touch(draft, pId);
    }),
  ),
setDialogField: ({ packId: pId, dialogId: dId, field, value }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      if (!dialog) return;
      (dialog as Record<string, unknown>)[field] = value;
      touch(draft, pId);
    }),
  ),
setDialogId: ({ packId: pId, oldId, newId }) => {
  const state = get();
  const pack = state.account.packs.find((p) => p.id === pId);
  if (!pack) throw new Error("pack not found");
  if (pack.dialogs.some((d) => d.id === newId)) throw new Error(`dialog id "${newId}" already exists`);
  const next = produce(state.account, (draft) => {
    const p = draft.packs.find((p) => p.id === pId)!;
    const d = p.dialogs.find((d) => d.id === oldId)!;
    d.id = newId;
    // rekey i18n entries: rename keys prefixed with dialogs.<oldId>
    const oldPrefix = `dialogs.${oldId}.`;
    const newPrefix = `dialogs.${newId}.`;
    for (const key of Object.keys(p.i18nKeys)) {
      if (key.startsWith(oldPrefix)) {
        const newKey = (newPrefix + key.slice(oldPrefix.length)) as I18nKey;
        p.i18nKeys[newKey] = p.i18nKeys[key as I18nKey]!;
        delete p.i18nKeys[key as I18nKey];
        // update LText ref
        updateDialogLTextKey(d, key as I18nKey, newKey);
      }
    }
    const layout = p.canvasLayout as Record<string, { x: number; y: number }>;
    if (layout[oldId as string]) {
      layout[newId as string] = layout[oldId as string]!;
      delete layout[oldId as string];
    }
  });
  set({ account: next });
},
addDialogBody: ({ packId: pId, dialogId: dId, body }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      if (!dialog) return;
      if (body.type === "text") {
        const key = dialogBodyTextKey(dId, dialog.body.length);
        pack!.i18nKeys[key] = { [pack!.defaultLang]: "" };
        dialog.body.push({ type: "text", text: { key } });
      } else {
        dialog.body.push(body);
      }
      touch(draft, pId);
    }),
  ),
removeDialogBody: ({ packId: pId, dialogId: dId, index }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      if (!dialog) return;
      const body = dialog.body[index];
      if (body?.type === "text") delete pack!.i18nKeys[body.text.key];
      dialog.body.splice(index, 1);
      touch(draft, pId);
    }),
  ),
setDialogBodyText: ({ packId: pId, dialogId: dId, index, lang, value }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      const body = dialog?.body[index];
      if (!body || body.type !== "text") return;
      if (!pack!.i18nKeys[body.text.key]) pack!.i18nKeys[body.text.key] = {};
      pack!.i18nKeys[body.text.key]![lang] = value;
      touch(draft, pId);
    }),
  ),
setDialogBodyMaterial: ({ packId: pId, dialogId: dId, index, material, count }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      const body = dialog?.body[index];
      if (!body || body.type !== "item") return;
      body.material = material;
      body.count = count;
      touch(draft, pId);
    }),
  ),
addDialogInput: ({ packId: pId, dialogId: dId, inputType }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      if (!dialog) return;
      const inputId = `input_${dialog.inputs.length}`;
      const labelKey = dialogInputLabelKey(dId, inputId);
      pack!.i18nKeys[labelKey] = { [pack!.defaultLang]: "" };
      let newInput: DialogInput;
      if (inputType === "text") {
        newInput = { type: "text", id: inputId, label: { key: labelKey }, default: "", maxLength: 32 };
      } else if (inputType === "bool") {
        newInput = { type: "bool", id: inputId, label: { key: labelKey }, default: false };
      } else if (inputType === "number_range") {
        newInput = { type: "number_range", id: inputId, label: { key: labelKey }, min: 0, max: 100, default: 0 };
      } else {
        newInput = { type: "single_option", id: inputId, label: { key: labelKey }, options: [], default: "" };
      }
      dialog.inputs.push(newInput);
      touch(draft, pId);
    }),
  ),
removeDialogInput: ({ packId: pId, dialogId: dId, index }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      if (!dialog) return;
      const input = dialog.inputs[index];
      if (input) {
        delete pack!.i18nKeys[input.label.key];
        if (input.type === "single_option") {
          for (const opt of input.options) delete pack!.i18nKeys[opt.label.key];
        }
        dialog.inputs.splice(index, 1);
      }
      touch(draft, pId);
    }),
  ),
setDialogInput: ({ packId: pId, dialogId: dId, index, patch }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      if (!dialog?.inputs[index]) return;
      Object.assign(dialog.inputs[index]!, patch);
      touch(draft, pId);
    }),
  ),
addDialogButton: ({ packId: pId, dialogId: dId }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      if (!dialog) return;
      const btnId = `btn_${dialog.buttons.length}`;
      const labelKey = dialogButtonLabelKey(dId, btnId);
      pack!.i18nKeys[labelKey] = { [pack!.defaultLang]: "" };
      dialog.buttons.push({ id: btnId, label: { key: labelKey }, steps: [] });
      touch(draft, pId);
    }),
  ),
removeDialogButton: ({ packId: pId, dialogId: dId, buttonIndex }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      if (!dialog) return;
      const btn = dialog.buttons[buttonIndex];
      if (btn) {
        delete pack!.i18nKeys[btn.label.key];
        for (const action of walkActions(btn.steps)) {
          if (action.type === "send_message") delete pack!.i18nKeys[action.text.key];
        }
        dialog.buttons.splice(buttonIndex, 1);
      }
      touch(draft, pId);
    }),
  ),
setDialogButtonLabel: ({ packId: pId, dialogId: dId, buttonIndex, lang, value }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      const btn = dialog?.buttons[buttonIndex];
      if (!btn) return;
      if (!pack!.i18nKeys[btn.label.key]) pack!.i18nKeys[btn.label.key] = {};
      pack!.i18nKeys[btn.label.key]![lang] = value;
      touch(draft, pId);
    }),
  ),
```

4f. Add the step mutation actions for dialog buttons. These mirror `addCommandStep`, `setCommandStep`, `removeCommandStep`, `moveCommandStep`, `addCommandIfCase`, `removeCommandIfCase`, `setCommandIfCaseConditions`, `setCommandIfCaseJoin`, `toggleCommandIfElse` — but scoped to `dialog.buttons[buttonIndex].steps`:

```typescript
addDialogButtonStep: ({ packId: pId, dialogId: dId, buttonIndex, frames, index, step, lang }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      const btn = dialog?.buttons[buttonIndex];
      if (!btn) return;
      const parent = resolveParentMut(btn.steps, frames);
      if (!parent) return;
      const s = allocateLTexts(step, pack!, lang);
      parent.splice(index, 0, s);
      touch(draft, pId);
    }),
  ),
moveDialogButtonStep: ({ packId: pId, dialogId: dId, buttonIndex, frames, fromIndex, toIndex }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      const btn = dialog?.buttons[buttonIndex];
      if (!btn) return;
      const parent = resolveParentMut(btn.steps, frames);
      if (!parent) return;
      const [moved] = parent.splice(fromIndex, 1);
      if (moved) parent.splice(toIndex, 0, moved);
      touch(draft, pId);
    }),
  ),
setDialogButtonStep: ({ packId: pId, dialogId: dId, buttonIndex, path, step, lang }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      const btn = dialog?.buttons[buttonIndex];
      if (!btn) return;
      const parent = resolveParentMut(btn.steps, path.frames);
      if (!parent) return;
      const s = allocateLTexts(step, pack!, lang);
      parent[path.index] = s;
      touch(draft, pId);
    }),
  ),
removeDialogButtonStep: ({ packId: pId, dialogId: dId, buttonIndex, path }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      const btn = dialog?.buttons[buttonIndex];
      if (!btn) return;
      const parent = resolveParentMut(btn.steps, path.frames);
      if (!parent) return;
      parent.splice(path.index, 1);
      touch(draft, pId);
    }),
  ),
addDialogButtonIfCase: ({ packId: pId, dialogId: dId, buttonIndex, frames, ifStepIndex }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      const btn = dialog?.buttons[buttonIndex];
      if (!btn) return;
      const parent = resolveParentMut(btn.steps, frames);
      if (!parent) return;
      const step = parent[ifStepIndex];
      if (!step || step.kind !== "if") return;
      step.cases.push({ conditions: [], steps: [] });
      touch(draft, pId);
    }),
  ),
removeDialogButtonIfCase: ({ packId: pId, dialogId: dId, buttonIndex, frames, ifStepIndex, caseIndex }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      const btn = dialog?.buttons[buttonIndex];
      if (!btn) return;
      const parent = resolveParentMut(btn.steps, frames);
      if (!parent) return;
      const step = parent[ifStepIndex];
      if (!step || step.kind !== "if") return;
      if (step.cases.length > 1) step.cases.splice(caseIndex, 1);
      touch(draft, pId);
    }),
  ),
setDialogButtonIfCaseConditions: ({ packId: pId, dialogId: dId, buttonIndex, frames, ifStepIndex, caseIndex, conditions, op }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      const btn = dialog?.buttons[buttonIndex];
      if (!btn) return;
      const parent = resolveParentMut(btn.steps, frames);
      if (!parent) return;
      const step = parent[ifStepIndex];
      if (!step || step.kind !== "if") return;
      const c = step.cases[caseIndex];
      if (!c) return;
      c.conditions = conditions;
      if (op !== undefined) c.joins = new Array(Math.max(0, conditions.length - 1)).fill(op) as ("and" | "or")[];
      touch(draft, pId);
    }),
  ),
setDialogButtonIfCaseJoin: ({ packId: pId, dialogId: dId, buttonIndex, frames, ifStepIndex, caseIndex, joinIndex, op }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      const btn = dialog?.buttons[buttonIndex];
      if (!btn) return;
      const parent = resolveParentMut(btn.steps, frames);
      if (!parent) return;
      const step = parent[ifStepIndex];
      if (!step || step.kind !== "if") return;
      const c = step.cases[caseIndex];
      if (!c) return;
      if (!c.joins) c.joins = [];
      c.joins[joinIndex] = op;
      touch(draft, pId);
    }),
  ),
toggleDialogButtonIfElse: ({ packId: pId, dialogId: dId, buttonIndex, frames, ifStepIndex, lang }) =>
  set(
    produce((draft: AccountState) => {
      const pack = draft.account.packs.find((p) => p.id === pId);
      const dialog = pack?.dialogs.find((d) => d.id === dId);
      const btn = dialog?.buttons[buttonIndex];
      if (!btn) return;
      const parent = resolveParentMut(btn.steps, frames);
      if (!parent) return;
      const step = parent[ifStepIndex];
      if (!step || step.kind !== "if") return;
      if (step.else) {
        step.else = undefined;
      } else {
        step.else = [];
      }
      touch(draft, pId);
    }),
  ),
```

> **Note on `allocateLTexts` and `touch`:** These are existing private helpers in `accountStore.ts`. `allocateLTexts(step, pack, lang)` walks a Step and allocates fresh i18nKeys for any LText fields. `touch(draft, packId)` updates `updatedAt`. Check their exact signatures by searching for `function allocateLTexts` and `function touch` in the file and use them exactly as the command mutations do.

Also add a private helper `updateDialogLTextKey` used by `setDialogId` (add near `gcDialogLTexts`):

```typescript
function updateDialogLTextKey(dialog: Dialog, oldKey: I18nKey, newKey: I18nKey): void {
  if (dialog.title.key === oldKey) { dialog.title.key = newKey; return; }
  for (const body of dialog.body) {
    if (body.type === "text" && body.text.key === oldKey) { body.text.key = newKey; return; }
  }
  for (const input of dialog.inputs) {
    if (input.label.key === oldKey) { input.label.key = newKey; return; }
    if (input.type === "single_option") {
      for (const opt of input.options) {
        if (opt.label.key === oldKey) { opt.label.key = newKey; return; }
      }
    }
  }
  for (const btn of dialog.buttons) {
    if (btn.label.key === oldKey) { btn.label.key = newKey; return; }
  }
}
```

- [ ] **Step 5: Run tests**

```bash
cd editor && npx vitest run src/state/accountStore.test.ts 2>&1 | head -60
```

Expected: all 4 new tests pass + all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
rtk git add editor/src/state/accountStore.ts editor/src/state/accountStore.test.ts editor/src/lib/i18nKeys.ts
rtk git commit -m "feat(editor): accountStore — createDialog, dialog CRUD, dialog button step mutations"
```

---

## Task 3: Canvas — DialogGroup + NewDialogDialog + Stage + ContextMenu

**Files:**
- Modify: `editor/src/features/canvas/menuLayout.ts`
- Create: `editor/src/features/canvas/DialogGroup.tsx`
- Create: `editor/src/features/canvas/NewDialogDialog.tsx`
- Modify: `editor/src/features/canvas/Stage.tsx`
- Modify: `editor/src/features/canvas/ContextMenu.tsx`

- [ ] **Step 1: Add `DIALOG_BOX` to `editor/src/features/canvas/menuLayout.ts`**

After `export const COMMAND_BOX = { width: 140, height: 48 };` add:

```typescript
export const DIALOG_BOX = { width: 140, height: 60 };
```

- [ ] **Step 2: Create `editor/src/features/canvas/DialogGroup.tsx`**

```typescript
import type { Dialog, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { useCallback } from "react";
import { Group, Rect, Text } from "react-konva";
import { DIALOG_BOX } from "./menuLayout";

interface DialogGroupProps {
  packId: PackId;
  dialog: Dialog;
  position: { x: number; y: number };
}

export function DialogGroup({ packId, dialog, position }: DialogGroupProps) {
  const setCanvasPosition = useAccountStore((s) => s.setCanvasPosition);
  const isSelected = useSelectionStore((s) => s.ids.has(dialog.id));

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      setCanvasPosition({ packId, nodeId: dialog.id, x: e.target.x(), y: e.target.y() });
    },
    [packId, dialog.id, setCanvasPosition],
  );

  const onClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      const additive = "evt" in e && (e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey);
      const { ids, set, toggle } = useSelectionStore.getState();
      if (additive) toggle(dialog.id);
      else if (!ids.has(dialog.id) || ids.size > 1) set([dialog.id]);
    },
    [dialog.id],
  );

  return (
    <Group
      x={position.x}
      y={position.y}
      draggable
      onDragEnd={onDragEnd}
      onClick={onClick}
      onTap={onClick}
      name={`dialog:${dialog.id}`}
      id={dialog.id}
    >
      <Rect
        width={DIALOG_BOX.width}
        height={DIALOG_BOX.height}
        cornerRadius={6}
        fill="#1f1f23"
        stroke={isSelected ? "#22c55e" : "#7c3aed"}
        strokeWidth={isSelected ? 2 : 1.5}
        perfectDrawEnabled={false}
      />
      <Text
        x={10}
        y={10}
        text={dialog.id}
        fontFamily="ui-monospace, monospace"
        fontSize={12}
        fontStyle="600"
        fill="#c4b5fd"
        listening={false}
      />
      <Text
        x={10}
        y={30}
        text={`dialog · ${dialog.buttons.length}btn`}
        fontFamily="ui-monospace, monospace"
        fontSize={9}
        fill="#71717a"
        listening={false}
      />
    </Group>
  );
}
```

- [ ] **Step 3: Create `editor/src/features/canvas/NewDialogDialog.tsx`**

```typescript
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useState } from "react";

interface NewDialogDialogProps {
  packId: PackId;
  open: boolean;
  position?: { x: number; y: number };
  onOpenChange: (open: boolean) => void;
}

export function NewDialogDialog({ packId, open, position, onOpenChange }: NewDialogDialogProps) {
  const [id, setId] = useState("");

  const submit = () => {
    if (!id.trim()) return;
    const dialogId = useAccountStore.getState().createDialog({ packId, id: id.trim(), position });
    useSelectionStore.getState().set([dialogId]);
    setId("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau dialogue</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Input
            placeholder="d_confirm_buy"
            value={id}
            onChange={(e) => setId(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button onClick={submit}>Créer</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Update `editor/src/features/canvas/ContextMenu.tsx`**

Add `onCreateDialogAt` to the `ContextMenuProps` interface:
```typescript
onCreateDialogAt: (world: { x: number; y: number }) => void;
```

Add to the function destructure params:
```typescript
onCreateDialogAt,
```

In the `"empty"` branch, add after "New command here":
```typescript
<DropdownMenuItem
  onSelect={() => {
    if (state.target.kind === "empty") onCreateDialogAt(state.target.world);
  }}
>
  New dialog here
</DropdownMenuItem>
```

- [ ] **Step 5: Update `editor/src/features/canvas/Stage.tsx`**

Add imports:
```typescript
import { DialogGroup } from "./DialogGroup";
import { NewDialogDialog } from "./NewDialogDialog";
```

Add state for dialog creation (next to `pendingMenuPos`):
```typescript
const [pendingDialogPos, setPendingDialogPos] = useState<{ x: number; y: number } | null>(null);
```

In the Konva `<Layer name="menus">` block, after the `pack.commands.map(...)` block:
```typescript
{pack.dialogs.map((dialog) => (
  <DialogGroup
    key={dialog.id}
    packId={packId}
    dialog={dialog}
    position={layout[dialog.id] ?? { x: 0, y: 0 }}
  />
))}
```

Wire `onCreateDialogAt` in the `<ContextMenu>` component (add the prop):
```typescript
onCreateDialogAt={(world) => {
  closeCtx();
  setPendingDialogPos(world);
}}
```

Add `<NewDialogDialog>` after `<NewMenuDialog>`:
```typescript
<NewDialogDialog
  packId={packId}
  open={pendingDialogPos !== null}
  position={pendingDialogPos ?? undefined}
  onOpenChange={(o) => { if (!o) setPendingDialogPos(null); }}
/>
```

- [ ] **Step 6: Run the dev server and verify dialog nodes appear on canvas**

```bash
cd editor && npm run dev
```

Right-click on empty canvas → "New dialog here" → enter id → dialog node appears as violet box.

- [ ] **Step 7: Commit**

```bash
rtk git add editor/src/features/canvas/menuLayout.ts editor/src/features/canvas/DialogGroup.tsx editor/src/features/canvas/NewDialogDialog.tsx editor/src/features/canvas/Stage.tsx editor/src/features/canvas/ContextMenu.tsx
rtk git commit -m "feat(editor): DialogGroup canvas node, NewDialogDialog, Stage/ContextMenu wiring"
```

---

## Task 4: FlowCanvas + DialogEditor + DialogButtonStepPseudocode

**Files:**
- Modify: `editor/src/features/flow/FlowCanvas.tsx`
- Modify: `editor/src/features/flow/PseudocodeView.tsx`

- [ ] **Step 1: Add dialog routing to `editor/src/features/flow/FlowCanvas.tsx`**

Import `Dialog` and `DialogId`:
```typescript
import type {
  Command,
  CommandArg,
  CommandId,
  Dialog,
  DialogId,
  Element,
  ElementId,
  Menu,
  MenuId,
  PackId,
} from "@/domain/types";
```

In `FlowCanvas`, after the `command` check and before the `menu.layers` loop:
```typescript
const dialog = pack.dialogs.find((d) => d.id === id);
if (dialog) return <DialogEditor packId={packId} dialog={dialog} />;
```

- [ ] **Step 2: Implement `DialogEditor` in `FlowCanvas.tsx`**

Add these imports to FlowCanvas.tsx (for dialog store actions):
```typescript
// Already imported: useAccountStore — add these action names to useAccountStore selectors in DialogEditor
```

Add `DialogButtonStepPseudocode` import at the top:
```typescript
import { CommandStepPseudocode, DialogButtonStepPseudocode, ElementClickHandlersPseudocode } from "./PseudocodeView";
```

Add the `DialogEditor` component at the end of `FlowCanvas.tsx` (before the `Lane` and `FieldLabel` helpers):

```typescript
function DialogIdField({ packId, dialogId }: { packId: PackId; dialogId: DialogId }) {
  const { t } = useTranslation();
  const setDialogId = useAccountStore((s) => s.setDialogId);
  const [draft, setDraft] = useState(dialogId as string);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setDraft(dialogId); setError(null); }, [dialogId]);

  const commit = () => {
    if (draft === dialogId) return;
    try {
      setDialogId({ packId, oldId: dialogId, newId: draft as DialogId });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename rejected");
      setDraft(dialogId);
    }
  };

  return (
    <div className="mb-3">
      <FieldLabel>id</FieldLabel>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { commit(); e.currentTarget.blur(); }
          else if (e.key === "Escape") { setDraft(dialogId); setError(null); e.currentTarget.blur(); }
        }}
        className={error ? "h-8 border-red-500/60 px-2 py-0 font-mono text-xs" : "h-8 px-2 py-0 font-mono text-xs"}
      />
      {error ? <div className="mt-1 text-[10px] text-red-300">{error}</div> : null}
    </div>
  );
}

function DialogEditor({ packId, dialog }: { packId: PackId; dialog: Dialog }) {
  const setDialogTitle = useAccountStore((s) => s.setDialogTitle);
  const setDialogField = useAccountStore((s) => s.setDialogField);
  const addDialogBody = useAccountStore((s) => s.addDialogBody);
  const removeDialogBody = useAccountStore((s) => s.removeDialogBody);
  const setDialogBodyText = useAccountStore((s) => s.setDialogBodyText);
  const setDialogBodyMaterial = useAccountStore((s) => s.setDialogBodyMaterial);
  const addDialogInput = useAccountStore((s) => s.addDialogInput);
  const removeDialogInput = useAccountStore((s) => s.removeDialogInput);
  const setDialogInput = useAccountStore((s) => s.setDialogInput);
  const addDialogButton = useAccountStore((s) => s.addDialogButton);
  const removeDialogButton = useAccountStore((s) => s.removeDialogButton);
  const setDialogButtonLabel = useAccountStore((s) => s.setDialogButtonLabel);
  const activeLang = useUiStore((s) => s.activeLang);
  const getText = useGetText(packId);

  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="border-zinc-800 border-b bg-zinc-900 px-3 py-2">
        <div className="font-mono text-xs text-violet-300">{dialog.id}</div>
        <div className="text-[10px] text-zinc-500">
          dialog · {dialog.buttons.length} button{dialog.buttons.length !== 1 ? "s" : ""}
        </div>
      </div>
      <div className="flex-1 overflow-auto px-3 py-3">
        <Lane label="identity">
          <DialogIdField packId={packId} dialogId={dialog.id} />
          <PropertyField
            label={`title (${activeLang})`}
            value={getText(dialog.title)}
            onChange={(v) => setDialogTitle({ packId, dialogId: dialog.id, lang: activeLang, value: v })}
          />
          <div className="mt-2 flex items-center gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400">
              <input
                type="checkbox"
                checked={dialog.canCloseWithEscape}
                onChange={(e) => setDialogField({ packId, dialogId: dialog.id, field: "canCloseWithEscape", value: e.target.checked })}
                className="h-3.5 w-3.5 accent-violet-500"
              />
              can close with Escape
            </label>
          </div>
        </Lane>

        <Lane label="body">
          <div className="flex flex-col gap-2">
            {dialog.body.map((body, i) => (
              <div key={i} className="flex items-start gap-1.5 rounded border border-zinc-800 bg-zinc-900/40 p-1.5">
                {body.type === "text" ? (
                  <div className="flex-1">
                    <FieldLabel>text ({activeLang})</FieldLabel>
                    <Input
                      value={getText({ key: body.text.key } as import("@/domain/types").LText)}
                      placeholder="Dialog body text…"
                      onChange={(e) => setDialogBodyText({ packId, dialogId: dialog.id, index: i, lang: activeLang, value: e.target.value })}
                      className="h-8 px-2 py-0 text-xs"
                    />
                  </div>
                ) : (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      value={body.material}
                      placeholder="DIAMOND"
                      onChange={(e) => setDialogBodyMaterial({ packId, dialogId: dialog.id, index: i, material: e.target.value.toUpperCase(), count: body.count })}
                      className="h-8 flex-1 px-2 py-0 font-mono text-xs"
                    />
                    <Input
                      type="number" min={1} max={64} value={body.count}
                      onChange={(e) => setDialogBodyMaterial({ packId, dialogId: dialog.id, index: i, material: body.material, count: Number(e.target.value) })}
                      className="h-8 w-16 px-2 py-0 text-xs"
                    />
                  </div>
                )}
                <button type="button" onClick={() => removeDialogBody({ packId, dialogId: dialog.id, index: i })}
                  className="flex h-7 w-7 items-center justify-center rounded text-[14px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">×</button>
              </div>
            ))}
            <div className="flex gap-1.5">
              <button type="button" onClick={() => addDialogBody({ packId, dialogId: dialog.id, body: { type: "text", text: { key: "" as import("@/domain/types").I18nKey } } })}
                className="rounded border border-zinc-700 border-dashed px-2 py-1 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200">+ text</button>
              <button type="button" onClick={() => addDialogBody({ packId, dialogId: dialog.id, body: { type: "item", material: "DIAMOND", count: 1 } })}
                className="rounded border border-zinc-700 border-dashed px-2 py-1 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200">+ item</button>
            </div>
          </div>
        </Lane>

        <Lane label="inputs">
          <div className="flex flex-col gap-2">
            {dialog.inputs.map((input, i) => (
              <div key={i} className="flex flex-col gap-1.5 rounded border border-zinc-800 bg-zinc-900/40 p-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">{input.type}</span>
                  <Input value={input.id} placeholder="input_id"
                    onChange={(e) => setDialogInput({ packId, dialogId: dialog.id, index: i, patch: { id: e.target.value } as Partial<import("@/domain/types").DialogInput> })}
                    className="h-7 w-28 px-2 py-0 font-mono text-xs" />
                  <Input value={getText(input.label)} placeholder="Label"
                    onChange={(e) => {
                      // setI18nValue for input label
                      useAccountStore.getState().setI18nValue({ packId, lt: input.label, lang: activeLang, value: e.target.value });
                    }}
                    className="h-7 flex-1 px-2 py-0 text-xs" />
                  <button type="button" onClick={() => removeDialogInput({ packId, dialogId: dialog.id, index: i })}
                    className="flex h-7 w-7 items-center justify-center rounded text-[14px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">×</button>
                </div>
                {input.type === "number_range" && (
                  <div className="flex items-center gap-2 pl-0.5">
                    <span className="font-mono text-[10px] text-zinc-500">min</span>
                    <Input type="number" value={input.min}
                      onChange={(e) => setDialogInput({ packId, dialogId: dialog.id, index: i, patch: { min: Number(e.target.value) } as Partial<import("@/domain/types").DialogInput> })}
                      className="h-7 w-20 px-2 py-0 text-xs" />
                    <span className="font-mono text-[10px] text-zinc-500">max</span>
                    <Input type="number" value={input.max}
                      onChange={(e) => setDialogInput({ packId, dialogId: dialog.id, index: i, patch: { max: Number(e.target.value) } as Partial<import("@/domain/types").DialogInput> })}
                      className="h-7 w-20 px-2 py-0 text-xs" />
                    <span className="font-mono text-[10px] text-zinc-500">default</span>
                    <Input type="number" value={input.default as number}
                      onChange={(e) => setDialogInput({ packId, dialogId: dialog.id, index: i, patch: { default: Number(e.target.value) } as Partial<import("@/domain/types").DialogInput> })}
                      className="h-7 w-20 px-2 py-0 text-xs" />
                  </div>
                )}
                {input.type === "text" && (
                  <div className="flex items-center gap-2 pl-0.5">
                    <span className="font-mono text-[10px] text-zinc-500">max_length</span>
                    <Input type="number" min={1} max={256} value={input.maxLength}
                      onChange={(e) => setDialogInput({ packId, dialogId: dialog.id, index: i, patch: { maxLength: Number(e.target.value) } as Partial<import("@/domain/types").DialogInput> })}
                      className="h-7 w-20 px-2 py-0 text-xs" />
                  </div>
                )}
                {input.type === "bool" && (
                  <div className="flex items-center gap-2 pl-0.5">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400">
                      <input type="checkbox" checked={input.default as boolean}
                        onChange={(e) => setDialogInput({ packId, dialogId: dialog.id, index: i, patch: { default: e.target.checked } as Partial<import("@/domain/types").DialogInput> })}
                        className="h-3.5 w-3.5 accent-violet-500" />
                      default checked
                    </label>
                  </div>
                )}
              </div>
            ))}
            <div className="flex flex-wrap gap-1.5">
              {(["text", "bool", "number_range", "single_option"] as const).map((type) => (
                <button key={type} type="button"
                  onClick={() => addDialogInput({ packId, dialogId: dialog.id, inputType: type })}
                  className="rounded border border-zinc-700 border-dashed px-2 py-1 text-[10px] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200">
                  + {type}
                </button>
              ))}
            </div>
          </div>
        </Lane>

        <Lane label="buttons">
          <div className="flex flex-col gap-3">
            {dialog.buttons.map((btn, btnIndex) => (
              <div key={btn.id} className="rounded border border-zinc-800 bg-zinc-900/40 p-2">
                <div className="mb-2 flex items-center gap-1.5">
                  <span className="font-mono text-[10px] text-zinc-500">{btn.id}</span>
                  <Input value={getText(btn.label)} placeholder="Button label"
                    onChange={(e) => setDialogButtonLabel({ packId, dialogId: dialog.id, buttonIndex: btnIndex, lang: activeLang, value: e.target.value })}
                    className="h-7 flex-1 px-2 py-0 text-xs" />
                  {dialog.buttons.length > 1 && (
                    <button type="button" onClick={() => removeDialogButton({ packId, dialogId: dialog.id, buttonIndex: btnIndex })}
                      className="flex h-7 w-7 items-center justify-center rounded text-[14px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">×</button>
                  )}
                </div>
                <div className="overflow-x-auto rounded border border-zinc-800 bg-zinc-900/40 p-2">
                  <DialogButtonStepPseudocode
                    packId={packId}
                    dialogId={dialog.id}
                    buttonIndex={btnIndex}
                    steps={btn.steps}
                    frames={[]}
                  />
                </div>
              </div>
            ))}
            <button type="button" onClick={() => addDialogButton({ packId, dialogId: dialog.id })}
              className="self-start rounded border border-zinc-700 border-dashed px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200">
              + button
            </button>
          </div>
        </Lane>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add `DialogButtonStepPseudocode` to `editor/src/features/flow/PseudocodeView.tsx`**

Add `DialogId` to the imports from `@/domain/types`.

Add these exports at the end of `PseudocodeView.tsx` (mirroring `CommandStepPseudocode` + `CommandStepTree` + `CommandStepLine`):

```typescript
// ────────────────────────────────────────────────────────────────────────────
// Dialog button step pseudocode — mirrors CommandStepPseudocode, scoped to
// dialog.buttons[buttonIndex].steps.
// ────────────────────────────────────────────────────────────────────────────

export function DialogButtonStepPseudocode({
  packId,
  dialogId,
  buttonIndex,
  steps,
  frames,
}: {
  packId: PackId;
  dialogId: DialogId;
  buttonIndex: number;
  steps: Step[];
  frames: StepFrame[];
}) {
  return (
    <DialogButtonStepTree
      packId={packId}
      dialogId={dialogId}
      buttonIndex={buttonIndex}
      steps={steps}
      frames={frames}
      indent={0}
    />
  );
}

function DialogButtonStepTree({
  packId,
  dialogId,
  buttonIndex,
  steps,
  frames,
  indent,
}: {
  packId: PackId;
  dialogId: DialogId;
  buttonIndex: number;
  steps: Step[];
  frames: StepFrame[];
  indent: number;
}) {
  const addDialogButtonStep = useAccountStore((s) => s.addDialogButtonStep);
  const moveDialogButtonStep = useAccountStore((s) => s.moveDialogButtonStep);
  const firstMenuId = useAccountStore(
    (s) => s.account.packs.find((p) => p.id === packId)?.menus[0]?.id,
  );
  const activeLang = useUiStore((s) => s.activeLang);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const ids = useStepIds(steps);

  const handleAdd = (newStep: Step) => {
    addDialogButtonStep({
      packId,
      dialogId,
      buttonIndex,
      frames,
      index: steps.length,
      step: newStep,
      lang: activeLang,
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const fromIndex = ids.indexOf(active.id as string);
    const toIndex = ids.indexOf(over.id as string);
    if (fromIndex < 0 || toIndex < 0) return;
    moveDialogButtonStep({ packId, dialogId, buttonIndex, frames, fromIndex, toIndex });
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col">
          {steps.map((step, i) => (
            <SortableStep key={i} id={ids[i]!}>
              <DialogButtonStepLine
                step={step}
                stepIndex={i}
                packId={packId}
                dialogId={dialogId}
                buttonIndex={buttonIndex}
                frames={frames}
                indent={indent}
              />
            </SortableStep>
          ))}
          <AddStepLine indent={indent} firstMenuId={firstMenuId} onPick={handleAdd} />
        </div>
      </SortableContext>
    </DndContext>
  );
}

function DialogButtonStepLine({
  step,
  stepIndex,
  packId,
  dialogId,
  buttonIndex,
  frames,
  indent,
}: {
  step: Step;
  stepIndex: number;
  packId: PackId;
  dialogId: DialogId;
  buttonIndex: number;
  frames: StepFrame[];
  indent: number;
}) {
  const setDialogButtonStep = useAccountStore((s) => s.setDialogButtonStep);
  const removeDialogButtonStep = useAccountStore((s) => s.removeDialogButtonStep);
  const addDialogButtonIfCase = useAccountStore((s) => s.addDialogButtonIfCase);
  const removeDialogButtonIfCase = useAccountStore((s) => s.removeDialogButtonIfCase);
  const setDialogButtonIfCaseConditions = useAccountStore((s) => s.setDialogButtonIfCaseConditions);
  const setDialogButtonIfCaseJoin = useAccountStore((s) => s.setDialogButtonIfCaseJoin);
  const toggleDialogButtonIfElse = useAccountStore((s) => s.toggleDialogButtonIfElse);
  const activeLang = useUiStore((s) => s.activeLang);

  const onRemove = () =>
    removeDialogButtonStep({ packId, dialogId, buttonIndex, path: { frames, index: stepIndex } });

  if (step.kind === "action") {
    return (
      <ActionLine
        step={step}
        indent={indent}
        onRemove={onRemove}
        onChange={(newStep) =>
          setDialogButtonStep({
            packId,
            dialogId,
            buttonIndex,
            path: { frames, index: stepIndex },
            step: newStep,
            lang: activeLang,
          })
        }
        packId={packId}
      />
    );
  }

  // if-step
  return (
    <IfStepBlock
      step={step}
      indent={indent}
      onRemove={onRemove}
      onAddCase={() =>
        addDialogButtonIfCase({ packId, dialogId, buttonIndex, frames, ifStepIndex: stepIndex })
      }
      onRemoveCase={(caseIndex) =>
        removeDialogButtonIfCase({ packId, dialogId, buttonIndex, frames, ifStepIndex: stepIndex, caseIndex })
      }
      onSetCaseConditions={(caseIndex, conditions) =>
        setDialogButtonIfCaseConditions({
          packId, dialogId, buttonIndex, frames, ifStepIndex: stepIndex, caseIndex, conditions,
        })
      }
      onSetCaseJoin={(caseIndex, joinIndex, op) =>
        setDialogButtonIfCaseJoin({
          packId, dialogId, buttonIndex, frames, ifStepIndex: stepIndex, caseIndex, joinIndex, op,
        })
      }
      onToggleElse={() =>
        toggleDialogButtonIfElse({ packId, dialogId, buttonIndex, frames, ifStepIndex: stepIndex, lang: activeLang })
      }
      renderChildren={(caseIndex, childSteps, childFrames) => (
        <DialogButtonStepTree
          packId={packId}
          dialogId={dialogId}
          buttonIndex={buttonIndex}
          steps={childSteps}
          frames={childFrames}
          indent={indent + 1}
        />
      )}
      renderElseChildren={(elseSteps, elseFrames) => (
        <DialogButtonStepTree
          packId={packId}
          dialogId={dialogId}
          buttonIndex={buttonIndex}
          steps={elseSteps}
          frames={elseFrames}
          indent={indent + 1}
        />
      )}
    />
  );
}
```

> **Note on `ActionLine`, `IfStepBlock`, `AddStepLine`, `SortableStep`, `useStepIds`:** These are existing unexported components/hooks within `PseudocodeView.tsx`. If they're not exported, add `export` to their declarations, or alternatively move them to a shared `StepPseudocodeShared.tsx`. Check whether `CommandStepLine` calls internal components and mirror the pattern exactly — if `CommandStepLine` uses `ActionLine` and `IfStepBlock`, export those and use them in `DialogButtonStepLine`.

- [ ] **Step 4: Test the editor UI manually**

```bash
cd editor && npm run dev
```

Create a dialog → click it → FlowCanvas should show the DialogEditor. Add body text, inputs, buttons. Verify the pseudocode step editor works in buttons.

- [ ] **Step 5: Run Vitest**

```bash
cd editor && npx vitest run 2>&1 | tail -20
```

Expected: all tests pass (no regressions).

- [ ] **Step 6: Commit**

```bash
rtk git add editor/src/features/flow/FlowCanvas.tsx editor/src/features/flow/PseudocodeView.tsx
rtk git commit -m "feat(editor): DialogEditor, DialogButtonStepPseudocode in FlowCanvas"
```

---

## Task 5: Export — dialog YAML serialization

**Files:**
- Modify: `editor/src/features/export/transform.ts`
- Modify: `editor/src/features/export/transform.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `editor/src/features/export/transform.test.ts`:

```typescript
import { dialogId, menuId, packId } from "@/domain/ids";
import type { Dialog, DialogButton, DialogId, I18nKey, Pack } from "@/domain/types";

// Helper to build a minimal pack with one dialog
function packWithDialog(dialog: Dialog): Pack {
  return {
    id: packId("p_test"),
    name: "Test",
    source: "user_created",
    createdAt: "",
    updatedAt: "",
    defaultLang: "en",
    menus: [],
    commands: [],
    dialogs: [dialog],
    templates: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {
      ["dialogs.d_test.title" as I18nKey]: { en: "Test Dialog" },
      ["dialogs.d_test.buttons.btn_confirm.label" as I18nKey]: { en: "Confirm" },
    } as Pack["i18nKeys"],
    canvasLayout: {},
  };
}

describe("transform — dialogs", () => {
  it("emits dialog yaml file", () => {
    const dialog: Dialog = {
      id: dialogId("d_test"),
      packId: packId("p_test"),
      title: { key: "dialogs.d_test.title" as I18nKey },
      canCloseWithEscape: true,
      body: [],
      inputs: [],
      buttons: [
        {
          id: "btn_confirm",
          label: { key: "dialogs.d_test.buttons.btn_confirm.label" as I18nKey },
          steps: [],
        },
      ],
    };
    const files = transform(packWithDialog(dialog));
    expect(files["plugins/Artisan/packs/p_test/dialogs/d_test.yaml"]).toBeDefined();
  });

  it("dialog yaml contains schema, id, title, can_close_with_escape", () => {
    const dialog: Dialog = {
      id: dialogId("d_test"),
      packId: packId("p_test"),
      title: { key: "dialogs.d_test.title" as I18nKey },
      canCloseWithEscape: false,
      body: [],
      inputs: [],
      buttons: [
        { id: "btn_confirm", label: { key: "dialogs.d_test.buttons.btn_confirm.label" as I18nKey }, steps: [] },
      ],
    };
    const files = transform(packWithDialog(dialog));
    const yaml = files["plugins/Artisan/packs/p_test/dialogs/d_test.yaml"]!;
    expect(yaml).toContain("schema: dialog/v1");
    expect(yaml).toContain("id: d_test");
    expect(yaml).toContain("can_close_with_escape: false");
    expect(yaml).toContain("{i18n:dialogs.d_test.title}");
  });

  it("manifest includes dialogs list", () => {
    const dialog: Dialog = {
      id: dialogId("d_test"),
      packId: packId("p_test"),
      title: { key: "dialogs.d_test.title" as I18nKey },
      canCloseWithEscape: true,
      body: [],
      inputs: [],
      buttons: [
        { id: "btn_confirm", label: { key: "dialogs.d_test.buttons.btn_confirm.label" as I18nKey }, steps: [] },
      ],
    };
    const files = transform(packWithDialog(dialog));
    const manifest = files["plugins/Artisan/packs/p_test/manifest.yaml"]!;
    expect(manifest).toContain("d_test");
  });

  it("button actions are serialized flat", () => {
    const dialog: Dialog = {
      id: dialogId("d_test"),
      packId: packId("p_test"),
      title: { key: "dialogs.d_test.title" as I18nKey },
      canCloseWithEscape: true,
      body: [],
      inputs: [],
      buttons: [
        {
          id: "btn_close",
          label: { key: "dialogs.d_test.buttons.btn_confirm.label" as I18nKey },
          steps: [{ kind: "action", action: { type: "close_dialog" } }],
        },
      ],
    };
    const files = transform(packWithDialog(dialog));
    const yaml = files["plugins/Artisan/packs/p_test/dialogs/d_test.yaml"]!;
    expect(yaml).toContain("close_dialog");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd editor && npx vitest run src/features/export/transform.test.ts 2>&1 | head -40
```

Expected: compile errors about `dialog` field missing from pack fixture, or test failures.

- [ ] **Step 3: Implement dialog serialization in `editor/src/features/export/transform.ts`**

Add `Dialog`, `DialogBody`, `DialogButton`, `DialogInput` to imports from `@/domain/types`.

Add helper for extracting flat actions from steps (after `serializeStep`):

```typescript
function extractFlatActions(steps: Step[]): unknown[] {
  const result: unknown[] = [];
  for (const step of steps) {
    if (step.kind === "action") result.push(serializeAction(step.action));
    // if-branches not exported in dialog button v1 (plugin expects flat actions)
  }
  return result;
}
```

Add dialog serialization functions (after `serializeCommand`):

```typescript
function serializeDialogBody(body: DialogBody): Record<string, unknown> {
  if (body.type === "text") return { type: "text", text: i18nRef(body.text.key) };
  return { type: "item", material: body.material, count: body.count };
}

function serializeDialogInput(input: DialogInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: input.id,
    type: input.type,
    label: i18nRef(input.label.key),
  };
  if (input.type === "text") {
    out.default = input.default;
    out.max_length = input.maxLength;
  } else if (input.type === "bool") {
    out.default = String(input.default);
  } else if (input.type === "number_range") {
    out.min = input.min;
    out.max = input.max;
    out.default = String(input.default);
  } else if (input.type === "single_option") {
    out.options = input.options.map((opt) => ({
      value: opt.value,
      label: i18nRef(opt.label.key),
    }));
    out.default = input.default;
  }
  return out;
}

function serializeDialogButton(btn: DialogButton): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: btn.id,
    label: i18nRef(btn.label.key),
  };
  const actions = extractFlatActions(btn.steps);
  if (actions.length > 0) out.actions = actions;
  return out;
}

function serializeDialog(dialog: Dialog): Record<string, unknown> {
  const out: Record<string, unknown> = {
    schema: "dialog/v1",
    id: dialog.id,
    title: i18nRef(dialog.title.key),
  };
  if (!dialog.canCloseWithEscape) out.can_close_with_escape = false;
  if (dialog.body.length > 0) out.body = dialog.body.map(serializeDialogBody);
  if (dialog.inputs.length > 0) out.inputs = dialog.inputs.map(serializeDialogInput);
  out.buttons = dialog.buttons.map(serializeDialogButton);
  return out;
}
```

Update `collectReferencedKeys` to walk dialog LTexts (add after the `for (const cmd of pack.commands)` loop):

```typescript
for (const dialog of pack.dialogs) {
  if (dialog.title) keys.add(dialog.title.key);
  for (const body of dialog.body) {
    if (body.type === "text") keys.add(body.text.key);
  }
  for (const input of dialog.inputs) {
    keys.add(input.label.key);
    if (input.type === "single_option") {
      for (const opt of input.options) keys.add(opt.label.key);
    }
  }
  for (const btn of dialog.buttons) {
    keys.add(btn.label.key);
    for (const action of walkActions(btn.steps)) {
      if (action.type === "send_message") keys.add(action.text.key);
    }
  }
}
```

Update `transform()` to emit dialog files and include in manifest (add after the `commands` loop):

```typescript
for (const dialog of pack.dialogs) {
  files[`${base}/dialogs/${dialog.id}.yaml`] = stringify(
    serializeDialog(dialog),
    yamlOpts,
  );
}
```

Update the manifest to include dialogs:

```typescript
files[`${base}/manifest.yaml`] = stringify(
  {
    schema: "manifest/v1",
    pack_id: pack.id,
    default_lang: pack.defaultLang,
    languages: langs,
    files: {
      menus: pack.menus.map((m) => m.id),
      commands: pack.commands.map((c) => c.id),
      dialogs: pack.dialogs.map((d) => d.id),
    },
  },
  yamlOpts,
);
```

Also import `Dialog`, `DialogBody`, `DialogButton`, `DialogInput` from `@/domain/types`.

- [ ] **Step 4: Run tests**

```bash
cd editor && npx vitest run src/features/export/transform.test.ts 2>&1 | head -40
```

Expected: all 4 new tests pass.

- [ ] **Step 5: Run full test suite**

```bash
cd editor && npx vitest run 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
rtk git add editor/src/features/export/transform.ts editor/src/features/export/transform.test.ts
rtk git commit -m "feat(editor): dialog YAML export, manifest dialogs list"
```

---

## Task 6: Locales + fixtures

**Files:**
- Modify: `editor/src/locales/en.ts`
- Modify: `editor/src/locales/fr.ts`
- Modify: `editor/src/mock/fixtures.ts` (if TypeScript errors remain)

- [ ] **Step 1: Add dialog UI strings to `editor/src/locales/en.ts`**

In the `packMini.countMenusCommands` section, update to include dialogs if used in that component. Also add a `dialog` section:

```typescript
canvas: {
  newDialogHere: "New dialog here",
},
dialog: {
  idLabel: "id",
  titleLabel: "title ({{lang}})",
  canCloseWithEscape: "can close with Escape",
  bodyLabel: "body",
  addBodyText: "+ text",
  addBodyItem: "+ item",
  inputsLabel: "inputs",
  buttonsLabel: "buttons",
  addButton: "+ button",
  bodyTextPlaceholder: "Dialog body text…",
  inputIdPlaceholder: "input_id",
  inputLabelPlaceholder: "Label",
  buttonLabelPlaceholder: "Button label",
  inputMaxLength: "max_length",
  inputMin: "min",
  inputMax: "max",
  inputDefault: "default",
  inputDefaultChecked: "default checked",
  noButtons: "At least one button required.",
  rename: "Rename dialog",
  renameRejected: "Rename rejected",
},
```

- [ ] **Step 2: Add dialog strings to `editor/src/locales/fr.ts`**

```typescript
canvas: {
  newDialogHere: "Nouveau dialogue ici",
},
dialog: {
  idLabel: "id",
  titleLabel: "titre ({{lang}})",
  canCloseWithEscape: "fermer avec Échap",
  bodyLabel: "corps",
  addBodyText: "+ texte",
  addBodyItem: "+ objet",
  inputsLabel: "entrées",
  buttonsLabel: "boutons",
  addButton: "+ bouton",
  bodyTextPlaceholder: "Texte du dialogue…",
  inputIdPlaceholder: "input_id",
  inputLabelPlaceholder: "Libellé",
  buttonLabelPlaceholder: "Libellé du bouton",
  inputMaxLength: "longueur_max",
  inputMin: "min",
  inputMax: "max",
  inputDefault: "défaut",
  inputDefaultChecked: "coché par défaut",
  noButtons: "Au moins un bouton est requis.",
  rename: "Renommer le dialogue",
  renameRejected: "Renommage refusé",
},
```

- [ ] **Step 3: Wire i18n keys into `DialogEditor` and `ContextMenu`**

In `FlowCanvas.tsx`, replace hardcoded strings in `DialogEditor` with `t("dialog.xxx")` calls. In `ContextMenu.tsx`, replace `"New dialog here"` with `t("canvas.newDialogHere")`.

- [ ] **Step 4: Run full test suite**

```bash
cd editor && npx vitest run 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Final manual smoke test**

With the dev server running:
1. Create a pack
2. Right-click canvas → New dialog here → enter `d_test` → dialog node appears violet
3. Click the dialog → DialogEditor shows in FlowCanvas
4. Edit title, toggle canCloseWithEscape, add a text body, add a `number_range` input, add a `close_dialog` action in the default button
5. Export the pack (topbar Export button) → verify the ZIP contains `dialogs/d_test.yaml` with correct content

- [ ] **Step 6: Commit**

```bash
rtk git add editor/src/locales/en.ts editor/src/locales/fr.ts editor/src/features/flow/FlowCanvas.tsx editor/src/features/canvas/ContextMenu.tsx
rtk git commit -m "feat(editor): dialog i18n strings, wire t() calls in DialogEditor"
```

---

## Self-Review

**Spec coverage:**
- ✅ `DialogId` type + `Dialog` domain type
- ✅ `dialogs: Dialog[]` on `Pack`
- ✅ `open_dialog`, `close_dialog` in `Action` union
- ✅ `createDialog` store action
- ✅ `NewDialogDialog.tsx` (same pattern as `NewMenuDialog.tsx`)
- ✅ `DialogGroup.tsx` Konva component (violet, shows id + button count)
- ✅ Stage + ContextMenu wired ("New dialog here")
- ✅ `FlowCanvas` routing to `DialogEditor`
- ✅ `DialogEditor` with title LText, `canCloseWithEscape`, body, inputs by type, buttons
- ✅ `DialogButtonStepPseudocode` reusing existing step infrastructure
- ✅ `transform.ts` dialog YAML export
- ✅ Manifest includes `dialogs` list
- ✅ i18n keys for all dialog strings
- ✅ Tests for store (createDialog, setDialogTitle, deleteFromPack, addDialogButton)
- ✅ Tests for export (yaml content, manifest)

**Placeholders:** None found.

**Type consistency:**
- `DialogId` used in `types.ts`, `ids.ts`, `accountStore.ts`, `FlowCanvas.tsx`, `PseudocodeView.tsx` — consistent throughout.
- `Dialog.buttons[i].steps: Step[]` — consistent with `Command.steps`.
- `serializeDialog` → `serializeDialogButton` → `extractFlatActions` → `serializeAction` — consistent action serialization.
