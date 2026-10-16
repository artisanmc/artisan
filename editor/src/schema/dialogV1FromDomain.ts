// Domain → `dialog/v1` writer: the inverse of `dialogV1ToDomain.ts`.
import { dialogsOf } from "@/domain/documents";
import type { Dialog, DialogBody, DialogButton, DialogInput, Project } from "@/domain/types";
import { stepsToStructured } from "@/lib/actions/structuredSteps";
import { type FieldTextOf, actionTextCodec, fieldTextOf } from "./fieldText";
import type { DocumentV1 } from "./menuV1FromDomain";

function serializeDialogBody(body: DialogBody, t: FieldTextOf): Record<string, unknown> {
  if (body.type === "text") return { type: "text", text: t(body.text.key) };
  return { type: "item", material: body.material, count: body.count };
}

function serializeDialogInput(input: DialogInput, t: FieldTextOf): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: input.id,
    type: input.type,
    label: t(input.label.key),
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
    out.options = input.options.map((opt) => ({ value: opt.value, label: t(opt.label.key) }));
    out.default = input.default;
  }
  return out;
}

function serializeDialogButton(
  btn: DialogButton,
  project: Project,
  t: FieldTextOf,
): Record<string, unknown> {
  const out: Record<string, unknown> = { id: btn.id, label: t(btn.label.key) };
  // Button actions serialize to structured steps (ADR `structured-action-wire`).
  const steps = stepsToStructured(btn.steps, actionTextCodec(project));
  if (steps.length > 0) out.actions = steps;
  return out;
}

export function dialogV1FromDomain(dialog: Dialog, project: Project): DocumentV1 {
  const t = fieldTextOf(project);
  const out: DocumentV1 = {
    schema: "dialog/v1",
    id: dialog.id,
    title: t(dialog.title.key),
  };
  if (!dialog.canCloseWithEscape) out.can_close_with_escape = false;
  if (dialog.body.length > 0) out.body = dialog.body.map((b) => serializeDialogBody(b, t));
  if (dialog.inputs.length > 0) out.inputs = dialog.inputs.map((i) => serializeDialogInput(i, t));
  out.buttons = dialog.buttons.map((b) => serializeDialogButton(b, project, t));
  return out;
}

/** Serialize every dialog in a project to canonical dialog/v1 objects. */
export function projectToDialogV1(project: Project): DocumentV1[] {
  return dialogsOf(project).map((d) => dialogV1FromDomain(d, project));
}
