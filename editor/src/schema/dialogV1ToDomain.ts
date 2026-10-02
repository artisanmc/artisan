import type {
  Dialog as DomainDialog,
  DialogBody,
  DialogInput,
  DialogButton,
  DialogId,
  I18nKey,
  LText,
  ProjectId,
} from "@/domain/types";
import { newI18nKey } from "@/lib/i18n";
import { makeStepConverter } from "./actionV1ToDomain";

// biome-ignore lint/suspicious/noExplicitAny: untyped wire object
type Json = Record<string, any>;

export interface DialogImportResult {
  dialog: DomainDialog;
  /** i18n keys allocated for literal text (to merge into project.i18nKeys by the caller). */
  i18nKeys: Record<string, Record<string, string>>;
  /** dialog/v1 constructs without a domain equivalent. */
  unsupported: string[];
}

export function dialogV1ToDomain(
  src: Json,
  opts: { projectId: ProjectId; lang: string; translations?: Record<string, Record<string, string>> },
): DialogImportResult {
  const i18nKeys: Record<string, Record<string, string>> = {};
  const unsupported: string[] = [];

  function ref(key: string): LText {
    const tr = opts.translations?.[key];
    if (tr) i18nKeys[key] = { ...tr };
    return { key: key as I18nKey };
  }
  function text(raw: string | Record<string, string> | undefined): LText {
    // Field-local map: the slot's languages travel with the document.
    if (raw && typeof raw === "object") {
      const key = newI18nKey();
      i18nKeys[key] = { ...raw };
      return { key };
    }
    const m = typeof raw === "string" ? /^\{i18n:(.+)\}$/.exec(raw) : null;
    if (m) return ref(m[1]!);
    const key = newI18nKey();
    i18nKeys[key] = { [opts.lang]: raw ?? "" };
    return { key };
  }

  const { steps: parseSteps } = makeStepConverter({
    text,
    ref,
    pushUnsupported: (s) => unsupported.push(s),
  });

  const body: DialogBody[] = ((src.body as Json[]) ?? [])
    .map((b): DialogBody | null => {
      if (b.type === "text") return { type: "text", text: text(b.text) };
      if (b.type === "item") return { type: "item", material: b.material, count: b.count ?? 1 };
      unsupported.push(`body type: ${b.type}`);
      return null;
    })
    .filter(Boolean) as DialogBody[];

  const inputs: DialogInput[] = ((src.inputs as Json[]) ?? [])
    .map((i): DialogInput | null => {
      switch (i.type) {
        case "text":
          return { type: "text", id: i.id, label: text(i.label), default: i.default ?? "", maxLength: i.max_length ?? 32 };
        case "bool":
          return { type: "bool", id: i.id, label: text(i.label), default: String(i.default) === "true" };
        case "number_range":
          return {
            type: "number_range",
            id: i.id,
            label: text(i.label),
            min: i.min ?? 0,
            max: i.max ?? 100,
            default: Number(i.default ?? 0),
          };
        case "single_option":
          return {
            type: "single_option",
            id: i.id,
            label: text(i.label),
            options: ((i.options as Json[]) ?? []).map((o) => ({ value: o.value, label: text(o.label) })),
            default: i.default ?? "",
          };
        default:
          unsupported.push(`input type: ${i.type}`);
          return null;
      }
    })
    .filter(Boolean) as DialogInput[];

  const buttons: DialogButton[] = ((src.buttons as Json[]) ?? []).map((b) => ({
    id: b.id,
    label: text(b.label),
    // dialog/v1 button `actions` is an Action DSL string (Phase 2). Unlike the
    // old flat-action wire, if-branches now round-trip.
    steps: parseSteps(b.actions),
  }));

  const dialog: DomainDialog = {
    id: src.id as DialogId,
    projectId: opts.projectId,
    title: text(src.title),
    canCloseWithEscape: src.can_close_with_escape !== false,
    body,
    inputs,
    buttons,
  };

  return { dialog, i18nKeys, unsupported };
}
