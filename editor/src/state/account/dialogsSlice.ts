import { type StepFrame, type StepPath, resolveParentMut, walkActions } from "@/domain/stepPath";
import type {
  Condition,
  Dialog,
  DialogBody,
  DialogId,
  DialogInput,
  I18nKey,
  ProjectId,
  Step,
} from "@/domain/types";
import {
  dialogBodyTextKey,
  dialogButtonKeyPrefix,
  dialogButtonLabelKey,
  dialogInputLabelKey,
  dialogTitleKey,
} from "@/lib/i18nKeys";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { produce } from "immer";
import {
  allocStepLTexts,
  gcStepLTexts,
  rewriteCanvasEdgeIds,
  rewriteCanvasGroupMembers,
  touch,
  updateDialogLTextKey,
} from "./helpers";
import type { AccountSliceContext, AccountState } from "./types";
import { dialogsOf, mutableDialogs } from "@/domain/documents";

/** Dialogs: bodies, inputs, buttons and the steps behind them. */
export interface DialogsSlice {
  createDialog: (input: {
    projectId: ProjectId;
    id: string;
    position?: { x: number; y: number };
  }) => DialogId;
  setDialogTitle: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    lang: string;
    value: string;
  }) => void;
  setDialogField: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    field: "canCloseWithEscape";
    value: boolean;
  }) => void;
  setDialogId: (input: { projectId: ProjectId; oldId: DialogId; newId: DialogId }) => void;
  addDialogBody: (input: { projectId: ProjectId; dialogId: DialogId; body: DialogBody }) => void;
  removeDialogBody: (input: { projectId: ProjectId; dialogId: DialogId; index: number }) => void;
  setDialogBodyText: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    index: number;
    lang: string;
    value: string;
  }) => void;
  setDialogBodyMaterial: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    index: number;
    material: string;
    count: number;
  }) => void;
  addDialogInput: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    inputType: DialogInput["type"];
  }) => void;
  removeDialogInput: (input: { projectId: ProjectId; dialogId: DialogId; index: number }) => void;
  setDialogInput: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    index: number;
    patch: Partial<DialogInput>;
  }) => void;
  addDialogButton: (input: { projectId: ProjectId; dialogId: DialogId }) => void;
  removeDialogButton: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
  }) => void;
  setDialogButtonLabel: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    lang: string;
    value: string;
  }) => void;
  addDialogButtonStep: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    index: number;
    step: Step;
    lang: string;
  }) => void;
  moveDialogButtonStep: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    fromIndex: number;
    toIndex: number;
  }) => void;
  setDialogButtonStep: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    path: StepPath;
    step: Step;
    lang: string;
  }) => void;
  removeDialogButtonStep: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    path: StepPath;
  }) => void;
  addDialogButtonIfCase: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    ifStepIndex: number;
  }) => void;
  removeDialogButtonIfCase: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
  }) => void;
  setDialogButtonIfCaseConditions: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    conditions: Condition[];
    op?: "and" | "or";
  }) => void;
  setDialogButtonIfCaseJoin: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    ifStepIndex: number;
    caseIndex: number;
    joinIndex: number;
    op: "and" | "or";
  }) => void;
  toggleDialogButtonIfElse: (input: {
    projectId: ProjectId;
    dialogId: DialogId;
    buttonIndex: number;
    frames: StepFrame[];
    ifStepIndex: number;
    lang: string;
    enabled: boolean;
  }) => void;
  /** Replace an entire dialog object in place (whole-dialog update). */
  updateDialog: (input: { projectId: ProjectId; dialog: Dialog }) => void;
}

export const createDialogsSlice = ({ set, get }: AccountSliceContext): DialogsSlice => ({
  createDialog: ({ projectId: pId, id, position }) => {
    const dId = id as DialogId;
    const titleKey = dialogTitleKey(id);
    const btnLabelKey = dialogButtonLabelKey(id, "btn_confirm");
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
        project.i18nKeys[titleKey] = { [project.defaultLang]: "" };
        project.i18nKeys[btnLabelKey] = { [project.defaultLang]: "Confirm" };
        mutableDialogs(project).push({
          id: dId,
          projectId: pId,
          title: { key: titleKey },
          canCloseWithEscape: true,
          body: [],
          inputs: [],
          buttons: [{ id: "btn_confirm", label: { key: btnLabelKey }, steps: [] }],
        });
        if (position) {
          (project.canvasLayout as Record<string, { x: number; y: number }>)[id] = position;
        }
        project.updatedAt = new Date().toISOString();
      }),
    );
    return dId;
  },
  setDialogTitle: ({ projectId: pId, dialogId: dId, lang, value }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        if (!dialog) return;
        if (!project.i18nKeys[dialog.title.key]) project.i18nKeys[dialog.title.key] = {};
        project.i18nKeys[dialog.title.key]![lang] = value;
        touch(draft, pId);
      }),
    ),
  setDialogField: ({ projectId: pId, dialogId: dId, field, value }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        if (!dialog) return;
        if (field === "canCloseWithEscape") dialog.canCloseWithEscape = value;
        touch(draft, pId);
      }),
    ),
  setDialogId: ({ projectId: pId, oldId, newId }) => {
    if (oldId === newId) return;
    if (!newId) throw new Error("dialog id cannot be empty");
    const state = get();
    const project = state.account.projects.find((p) => p.id === pId);
    if (!project) throw new Error("project not found");
    if (dialogsOf(project).some((d) => d.id === newId))
      throw new Error(`dialog id "${newId}" already exists`);
    const next = produce(state.account, (draft) => {
      const p = draft.projects.find((p) => p.id === pId)!;
      const d = dialogsOf(p).find((d) => d.id === oldId)!;
      d.id = newId;
      const oldPrefix = `dialogs.${oldId}.`;
      const newPrefix = `dialogs.${newId}.`;
      for (const key of Object.keys(p.i18nKeys)) {
        if (key.startsWith(oldPrefix)) {
          const newKey = (newPrefix + key.slice(oldPrefix.length)) as I18nKey;
          p.i18nKeys[newKey] = p.i18nKeys[key as I18nKey]!;
          delete p.i18nKeys[key as I18nKey];
          updateDialogLTextKey(d, key as I18nKey, newKey);
        }
      }
      const layout = p.canvasLayout as Record<string, { x: number; y: number }>;
      if (layout[oldId as string]) {
        layout[newId as string] = layout[oldId as string]!;
        delete layout[oldId as string];
      }
      rewriteCanvasEdgeIds(p, oldId as string, newId as string);
      rewriteCanvasGroupMembers(p, oldId as string, newId as string);
      p.updatedAt = new Date().toISOString();
    });
    set({ account: next });
    // Renaming is a MOVE, and only the editor knows it: the tree alone would
    // only show a disappearance and an appearance. Without this intent, the
    // trash archives a deletion that is not one and the file's history is
    // orphaned from its new name. Recorded once the rename is applied: a
    // refused one must leave no intent behind in the draft.
    useProjectDraftStore
      .getState()
      .recordRename(pId, `dialogs/${oldId}.yaml`, `dialogs/${newId}.yaml`);
  },
  addDialogBody: ({ projectId: pId, dialogId: dId, body }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        if (!dialog) return;
        if (body.type === "text") {
          const key = dialogBodyTextKey(dId, dialog.body.length);
          project!.i18nKeys[key] = { [project!.defaultLang]: "" };
          dialog.body.push({ type: "text", text: { key } });
        } else {
          dialog.body.push(body);
        }
        touch(draft, pId);
      }),
    ),
  removeDialogBody: ({ projectId: pId, dialogId: dId, index }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        if (!dialog) return;
        const body = dialog.body[index];
        if (body?.type === "text") delete project!.i18nKeys[body.text.key];
        dialog.body.splice(index, 1);
        touch(draft, pId);
      }),
    ),
  setDialogBodyText: ({ projectId: pId, dialogId: dId, index, lang, value }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        const body = dialog?.body[index];
        if (!body || body.type !== "text") return;
        if (!project!.i18nKeys[body.text.key]) project!.i18nKeys[body.text.key] = {};
        project!.i18nKeys[body.text.key]![lang] = value;
        touch(draft, pId);
      }),
    ),
  setDialogBodyMaterial: ({ projectId: pId, dialogId: dId, index, material, count }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        const body = dialog?.body[index];
        if (!body || body.type !== "item") return;
        body.material = material;
        body.count = count;
        touch(draft, pId);
      }),
    ),
  addDialogInput: ({ projectId: pId, dialogId: dId, inputType }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        if (!dialog) return;
        const inputId = `input_${dialog.inputs.length}`;
        const labelKey = dialogInputLabelKey(dId, inputId);
        project!.i18nKeys[labelKey] = { [project!.defaultLang]: "" };
        let newInput: DialogInput;
        if (inputType === "text") {
          newInput = {
            type: "text",
            id: inputId,
            label: { key: labelKey },
            default: "",
            maxLength: 32,
          };
        } else if (inputType === "bool") {
          newInput = {
            type: "bool",
            id: inputId,
            label: { key: labelKey },
            default: false,
          };
        } else if (inputType === "number_range") {
          newInput = {
            type: "number_range",
            id: inputId,
            label: { key: labelKey },
            min: 0,
            max: 100,
            default: 0,
          };
        } else {
          newInput = {
            type: "single_option",
            id: inputId,
            label: { key: labelKey },
            options: [],
            default: "",
          };
        }
        dialog.inputs.push(newInput);
        touch(draft, pId);
      }),
    ),
  removeDialogInput: ({ projectId: pId, dialogId: dId, index }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        if (!dialog) return;
        const input = dialog.inputs[index];
        if (input) {
          delete project!.i18nKeys[input.label.key];
          if (input.type === "single_option") {
            for (const opt of input.options) delete project!.i18nKeys[opt.label.key];
          }
          dialog.inputs.splice(index, 1);
        }
        touch(draft, pId);
      }),
    ),
  setDialogInput: ({ projectId: pId, dialogId: dId, index, patch }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        if (!dialog?.inputs[index]) return;
        Object.assign(dialog.inputs[index]!, patch);
        touch(draft, pId);
      }),
    ),
  addDialogButton: ({ projectId: pId, dialogId: dId }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        if (!dialog) return;
        const btnId = `btn_${dialog.buttons.length}`;
        const labelKey = dialogButtonLabelKey(dId, btnId);
        project!.i18nKeys[labelKey] = { [project!.defaultLang]: "" };
        dialog.buttons.push({ id: btnId, label: { key: labelKey }, steps: [] });
        touch(draft, pId);
      }),
    ),
  removeDialogButton: ({ projectId: pId, dialogId: dId, buttonIndex }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        if (!dialog) return;
        const btn = dialog.buttons[buttonIndex];
        if (btn) {
          delete project!.i18nKeys[btn.label.key];
          for (const action of walkActions(btn.steps)) {
            if (action.type === "send_message" || action.type === "broadcast")
              delete project!.i18nKeys[action.text.key];
            else if (action.type === "show_title") {
              delete project!.i18nKeys[action.title.key];
              if (action.subtitle) delete project!.i18nKeys[action.subtitle.key];
            }
          }
          dialog.buttons.splice(buttonIndex, 1);
        }
        touch(draft, pId);
      }),
    ),
  setDialogButtonLabel: ({ projectId: pId, dialogId: dId, buttonIndex, lang, value }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        const btn = dialog?.buttons[buttonIndex];
        if (!btn) return;
        if (!project!.i18nKeys[btn.label.key]) project!.i18nKeys[btn.label.key] = {};
        project!.i18nKeys[btn.label.key]![lang] = value;
        touch(draft, pId);
      }),
    ),
  addDialogButtonStep: ({
    projectId: pId,
    dialogId: dId,
    buttonIndex,
    frames,
    index,
    step,
    lang,
  }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        const btn = dialog?.buttons[buttonIndex];
        if (!project || !btn) return;
        const parent = resolveParentMut(btn.steps, frames);
        if (!parent) return;
        const at = index < 0 || index > parent.length ? parent.length : index;
        parent.splice(at, 0, step);
        allocStepLTexts(project, btn.steps, lang, dialogButtonKeyPrefix(dId, btn.id));
        touch(draft, pId);
      }),
    ),
  moveDialogButtonStep: ({
    projectId: pId,
    dialogId: dId,
    buttonIndex,
    frames,
    fromIndex,
    toIndex,
  }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        const btn = dialog?.buttons[buttonIndex];
        if (!btn) return;
        const parent = resolveParentMut(btn.steps, frames);
        if (!parent) return;
        if (fromIndex < 0 || fromIndex >= parent.length) return;
        if (toIndex < 0 || toIndex >= parent.length) return;
        const [moved] = parent.splice(fromIndex, 1);
        if (moved) parent.splice(toIndex, 0, moved);
        touch(draft, pId);
      }),
    ),
  setDialogButtonStep: ({ projectId: pId, dialogId: dId, buttonIndex, path, step, lang }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        const btn = dialog?.buttons[buttonIndex];
        if (!project || !btn) return;
        const parent = resolveParentMut(btn.steps, path.frames);
        if (!parent || path.index < 0 || path.index >= parent.length) return;
        gcStepLTexts(project, [parent[path.index]!]);
        parent[path.index] = step;
        allocStepLTexts(project, btn.steps, lang, dialogButtonKeyPrefix(dId, btn.id));
        touch(draft, pId);
      }),
    ),
  removeDialogButtonStep: ({ projectId: pId, dialogId: dId, buttonIndex, path }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        const btn = dialog?.buttons[buttonIndex];
        if (!project || !btn) return;
        const parent = resolveParentMut(btn.steps, path.frames);
        if (!parent || path.index < 0 || path.index >= parent.length) return;
        gcStepLTexts(project, [parent[path.index]!]);
        parent.splice(path.index, 1);
        touch(draft, pId);
      }),
    ),
  addDialogButtonIfCase: ({ projectId: pId, dialogId: dId, buttonIndex, frames, ifStepIndex }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        const btn = dialog?.buttons[buttonIndex];
        if (!btn) return;
        const parent = resolveParentMut(btn.steps, frames);
        const ifStep = parent?.[ifStepIndex];
        if (!ifStep || ifStep.kind !== "if") return;
        ifStep.cases.push({ conditions: [], steps: [] });
        touch(draft, pId);
      }),
    ),
  removeDialogButtonIfCase: ({
    projectId: pId,
    dialogId: dId,
    buttonIndex,
    frames,
    ifStepIndex,
    caseIndex,
  }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        const btn = dialog?.buttons[buttonIndex];
        if (!project || !btn) return;
        const parent = resolveParentMut(btn.steps, frames);
        const ifStep = parent?.[ifStepIndex];
        if (!ifStep || ifStep.kind !== "if") return;
        if (caseIndex < 0 || caseIndex >= ifStep.cases.length) return;
        if (ifStep.cases.length > 1) {
          gcStepLTexts(project, ifStep.cases[caseIndex]!.steps);
          ifStep.cases.splice(caseIndex, 1);
        }
        touch(draft, pId);
      }),
    ),
  setDialogButtonIfCaseConditions: ({
    projectId: pId,
    dialogId: dId,
    buttonIndex,
    frames,
    ifStepIndex,
    caseIndex,
    conditions,
    op,
  }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        const btn = dialog?.buttons[buttonIndex];
        if (!btn) return;
        const parent = resolveParentMut(btn.steps, frames);
        const ifStep = parent?.[ifStepIndex];
        if (!ifStep || ifStep.kind !== "if") return;
        const c = ifStep.cases[caseIndex];
        if (!c) return;
        c.conditions = conditions;
        if (op !== undefined)
          c.joins = new Array(Math.max(0, conditions.length - 1)).fill(op) as ("and" | "or")[];
        touch(draft, pId);
      }),
    ),
  setDialogButtonIfCaseJoin: ({
    projectId: pId,
    dialogId: dId,
    buttonIndex,
    frames,
    ifStepIndex,
    caseIndex,
    joinIndex,
    op,
  }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        const btn = dialog?.buttons[buttonIndex];
        if (!btn) return;
        const parent = resolveParentMut(btn.steps, frames);
        const ifStep = parent?.[ifStepIndex];
        if (!ifStep || ifStep.kind !== "if") return;
        const c = ifStep.cases[caseIndex];
        if (!c) return;
        if (!c.joins) c.joins = [];
        c.joins[joinIndex] = op;
        touch(draft, pId);
      }),
    ),
  toggleDialogButtonIfElse: ({
    projectId: pId,
    dialogId: dId,
    buttonIndex,
    frames,
    ifStepIndex,
    lang: _lang,
    enabled,
  }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        const dialog = dialogsOf(project).find((d) => d.id === dId);
        const btn = dialog?.buttons[buttonIndex];
        if (!project || !btn) return;
        const parent = resolveParentMut(btn.steps, frames);
        const ifStep = parent?.[ifStepIndex];
        if (!ifStep || ifStep.kind !== "if") return;
        if (enabled) {
          if (!ifStep.else) ifStep.else = [];
        } else {
          if (ifStep.else) {
            gcStepLTexts(project, ifStep.else);
            ifStep.else = undefined;
          }
        }
        touch(draft, pId);
      }),
    ),
  updateDialog: ({ projectId: pId, dialog }) =>
    set(
      produce((draft: AccountState) => {
        const project = draft.account.projects.find((p) => p.id === pId);
        if (!project) return;
        const idx = dialogsOf(project).findIndex((d) => d.id === dialog.id);
        if (idx === -1) return;
        mutableDialogs(project)[idx] = dialog;
        project.updatedAt = new Date().toISOString();
      }),
    ),
});
