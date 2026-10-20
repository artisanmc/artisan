import { dialogsOf, mutableDialogs, renamedDocumentFiles } from "@/domain/documents";
import { type StepFrame, type StepPath, resolveParentMut } from "@/domain/stepPath";
import type {
  Condition,
  Dialog,
  DialogBody,
  DialogButton,
  DialogId,
  DialogInput,
  I18nKey,
  Project,
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
import {
  allocStepLTexts,
  gcStepLTexts,
  rewriteCanvasEdgeIds,
  updateDialogLTextKey,
} from "./helpers";
import type { Mutation } from "./mutate";
import type { ProjectsSliceContext } from "./types";

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

export const createDialogsSlice = ({
  get,
  mutateProject,
  mutateDialog,
}: ProjectsSliceContext): DialogsSlice => {
  /** A button of a dialog; a no-op when either is missing. */
  const mutateButton = (
    pId: ProjectId,
    dId: DialogId,
    buttonIndex: number,
    fn: Mutation<[btn: DialogButton, project: Project]>,
  ) =>
    mutateDialog(pId, dId, (dialog, project) => {
      const btn = dialog.buttons[buttonIndex];
      return btn ? fn(btn, project) : false;
    });
  /** The `if` step at `ifStepIndex` under `frames` in a button's chain. */
  const mutateButtonIf = (
    pId: ProjectId,
    dId: DialogId,
    buttonIndex: number,
    frames: StepFrame[],
    ifStepIndex: number,
    fn: Mutation<[ifStep: Extract<Step, { kind: "if" }>, project: Project]>,
  ) =>
    mutateButton(pId, dId, buttonIndex, (btn, project) => {
      const ifStep = resolveParentMut(btn.steps, frames)?.[ifStepIndex];
      if (!ifStep || ifStep.kind !== "if") return false;
      return fn(ifStep, project);
    });

  return {
    createDialog: ({ projectId: pId, id, position }) => {
      const dId = id as DialogId;
      const titleKey = dialogTitleKey(id);
      const btnLabelKey = dialogButtonLabelKey(id, "btn_confirm");
      mutateProject(pId, (project) => {
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
      });
      return dId;
    },
    setDialogTitle: ({ projectId: pId, dialogId: dId, lang, value }) =>
      mutateDialog(pId, dId, (dialog, project) => {
        if (!project.i18nKeys[dialog.title.key]) project.i18nKeys[dialog.title.key] = {};
        project.i18nKeys[dialog.title.key]![lang] = value;
      }),
    setDialogField: ({ projectId: pId, dialogId: dId, field, value }) =>
      mutateDialog(pId, dId, (dialog) => {
        if (field === "canCloseWithEscape") dialog.canCloseWithEscape = value;
      }),
    setDialogId: ({ projectId: pId, oldId, newId }) => {
      if (oldId === newId) return;
      if (!newId) throw new Error("dialog id cannot be empty");
      const project = get().openProjects.projects.find((p) => p.id === pId);
      if (!project) throw new Error("project not found");
      if (dialogsOf(project).some((d) => d.id === newId))
        throw new Error(`dialog id "${newId}" already exists`);
      mutateProject(pId, (p) => {
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
      });
      // Renaming is a MOVE, and only the editor knows it: the tree alone would
      // only show a disappearance and an appearance. Without this intent, the
      // trash archives a deletion that is not one and the file's history is
      // orphaned from its new name. Recorded once the rename is applied: a
      // refused one must leave no intent behind in the draft.
      const moved = renamedDocumentFiles(
        get().openProjects.projects.find((p) => p.id === pId),
        "dialog",
        oldId as string,
        newId as string,
      );
      useProjectDraftStore.getState().recordRename(pId, moved.from, moved.to);
    },
    addDialogBody: ({ projectId: pId, dialogId: dId, body }) =>
      mutateDialog(pId, dId, (dialog, project) => {
        if (body.type === "text") {
          const key = dialogBodyTextKey(dId, dialog.body.length);
          project.i18nKeys[key] = { [project.defaultLang]: "" };
          dialog.body.push({ type: "text", text: { key } });
        } else {
          dialog.body.push(body);
        }
      }),
    removeDialogBody: ({ projectId: pId, dialogId: dId, index }) =>
      mutateDialog(pId, dId, (dialog, project) => {
        const body = dialog.body[index];
        if (body?.type === "text") delete project.i18nKeys[body.text.key];
        dialog.body.splice(index, 1);
      }),
    setDialogBodyText: ({ projectId: pId, dialogId: dId, index, lang, value }) =>
      mutateDialog(pId, dId, (dialog, project) => {
        const body = dialog.body[index];
        if (!body || body.type !== "text") return false;
        if (!project.i18nKeys[body.text.key]) project.i18nKeys[body.text.key] = {};
        project.i18nKeys[body.text.key]![lang] = value;
      }),
    setDialogBodyMaterial: ({ projectId: pId, dialogId: dId, index, material, count }) =>
      mutateDialog(pId, dId, (dialog) => {
        const body = dialog.body[index];
        if (!body || body.type !== "item") return false;
        body.material = material;
        body.count = count;
      }),
    addDialogInput: ({ projectId: pId, dialogId: dId, inputType }) =>
      mutateDialog(pId, dId, (dialog, project) => {
        const inputId = `input_${dialog.inputs.length}`;
        const labelKey = dialogInputLabelKey(dId, inputId);
        project.i18nKeys[labelKey] = { [project.defaultLang]: "" };
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
      }),
    removeDialogInput: ({ projectId: pId, dialogId: dId, index }) =>
      mutateDialog(pId, dId, (dialog, project) => {
        const input = dialog.inputs[index];
        if (input) {
          delete project.i18nKeys[input.label.key];
          if (input.type === "single_option") {
            for (const opt of input.options) delete project.i18nKeys[opt.label.key];
          }
          dialog.inputs.splice(index, 1);
        }
      }),
    setDialogInput: ({ projectId: pId, dialogId: dId, index, patch }) =>
      mutateDialog(pId, dId, (dialog) => {
        if (!dialog.inputs[index]) return false;
        Object.assign(dialog.inputs[index]!, patch);
      }),
    addDialogButton: ({ projectId: pId, dialogId: dId }) =>
      mutateDialog(pId, dId, (dialog, project) => {
        const btnId = `btn_${dialog.buttons.length}`;
        const labelKey = dialogButtonLabelKey(dId, btnId);
        project.i18nKeys[labelKey] = { [project.defaultLang]: "" };
        dialog.buttons.push({ id: btnId, label: { key: labelKey }, steps: [] });
      }),
    removeDialogButton: ({ projectId: pId, dialogId: dId, buttonIndex }) =>
      mutateDialog(pId, dId, (dialog, project) => {
        const btn = dialog.buttons[buttonIndex];
        if (btn) {
          delete project.i18nKeys[btn.label.key];
          gcStepLTexts(project, btn.steps);
          dialog.buttons.splice(buttonIndex, 1);
        }
      }),
    setDialogButtonLabel: ({ projectId: pId, dialogId: dId, buttonIndex, lang, value }) =>
      mutateButton(pId, dId, buttonIndex, (btn, project) => {
        if (!project.i18nKeys[btn.label.key]) project.i18nKeys[btn.label.key] = {};
        project.i18nKeys[btn.label.key]![lang] = value;
      }),
    addDialogButtonStep: ({
      projectId: pId,
      dialogId: dId,
      buttonIndex,
      frames,
      index,
      step,
      lang,
    }) =>
      mutateButton(pId, dId, buttonIndex, (btn, project) => {
        const parent = resolveParentMut(btn.steps, frames);
        if (!parent) return false;
        const at = index < 0 || index > parent.length ? parent.length : index;
        parent.splice(at, 0, step);
        allocStepLTexts(project, btn.steps, lang, dialogButtonKeyPrefix(dId, btn.id));
      }),
    moveDialogButtonStep: ({
      projectId: pId,
      dialogId: dId,
      buttonIndex,
      frames,
      fromIndex,
      toIndex,
    }) =>
      mutateButton(pId, dId, buttonIndex, (btn) => {
        const parent = resolveParentMut(btn.steps, frames);
        if (!parent) return false;
        if (fromIndex < 0 || fromIndex >= parent.length) return false;
        if (toIndex < 0 || toIndex >= parent.length) return false;
        const [moved] = parent.splice(fromIndex, 1);
        if (moved) parent.splice(toIndex, 0, moved);
      }),
    setDialogButtonStep: ({ projectId: pId, dialogId: dId, buttonIndex, path, step, lang }) =>
      mutateButton(pId, dId, buttonIndex, (btn, project) => {
        const parent = resolveParentMut(btn.steps, path.frames);
        if (!parent || path.index < 0 || path.index >= parent.length) return false;
        gcStepLTexts(project, [parent[path.index]!]);
        parent[path.index] = step;
        allocStepLTexts(project, btn.steps, lang, dialogButtonKeyPrefix(dId, btn.id));
      }),
    removeDialogButtonStep: ({ projectId: pId, dialogId: dId, buttonIndex, path }) =>
      mutateButton(pId, dId, buttonIndex, (btn, project) => {
        const parent = resolveParentMut(btn.steps, path.frames);
        if (!parent || path.index < 0 || path.index >= parent.length) return false;
        gcStepLTexts(project, [parent[path.index]!]);
        parent.splice(path.index, 1);
      }),
    addDialogButtonIfCase: ({ projectId: pId, dialogId: dId, buttonIndex, frames, ifStepIndex }) =>
      mutateButtonIf(pId, dId, buttonIndex, frames, ifStepIndex, (ifStep) => {
        ifStep.cases.push({ conditions: [], steps: [] });
      }),
    removeDialogButtonIfCase: ({
      projectId: pId,
      dialogId: dId,
      buttonIndex,
      frames,
      ifStepIndex,
      caseIndex,
    }) =>
      mutateButtonIf(pId, dId, buttonIndex, frames, ifStepIndex, (ifStep, project) => {
        if (caseIndex < 0 || caseIndex >= ifStep.cases.length) return false;
        if (ifStep.cases.length > 1) {
          gcStepLTexts(project, ifStep.cases[caseIndex]!.steps);
          ifStep.cases.splice(caseIndex, 1);
        }
      }),
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
      mutateButtonIf(pId, dId, buttonIndex, frames, ifStepIndex, (ifStep) => {
        const c = ifStep.cases[caseIndex];
        if (!c) return false;
        c.conditions = conditions;
        if (op !== undefined)
          c.joins = new Array(Math.max(0, conditions.length - 1)).fill(op) as ("and" | "or")[];
      }),
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
      mutateButtonIf(pId, dId, buttonIndex, frames, ifStepIndex, (ifStep) => {
        const c = ifStep.cases[caseIndex];
        if (!c) return false;
        if (!c.joins) c.joins = [];
        c.joins[joinIndex] = op;
      }),
    toggleDialogButtonIfElse: ({
      projectId: pId,
      dialogId: dId,
      buttonIndex,
      frames,
      ifStepIndex,
      lang: _lang,
      enabled,
    }) =>
      mutateButtonIf(pId, dId, buttonIndex, frames, ifStepIndex, (ifStep, project) => {
        if (enabled) {
          if (!ifStep.else) ifStep.else = [];
        } else {
          if (ifStep.else) {
            gcStepLTexts(project, ifStep.else);
            ifStep.else = undefined;
          }
        }
      }),
    updateDialog: ({ projectId: pId, dialog }) =>
      mutateProject(pId, (project) => {
        const idx = dialogsOf(project).findIndex((d) => d.id === dialog.id);
        if (idx === -1) return false;
        mutableDialogs(project)[idx] = dialog;
      }),
  };
};
