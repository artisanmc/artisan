import { menusOf } from "@/domain/documents";
import type { Appearance, LText, Project } from "@/domain/types";
import type { PartsEdit } from "@/state/projects/elementsSlice";
import { parse, stringify } from "yaml";

/** A component's file as read: its parameters and its parts, anything else kept. */
export interface ComponentFile {
  params?: Record<string, { type?: string; default?: unknown; values?: unknown } | null>;
  parts?: unknown[];
  [key: string]: unknown;
}

type Json = Record<string, unknown>;
const isMap = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** The Project's components as it holds them: name to the file's text. */
export function projectComponents(project: Project | undefined): Record<string, string> {
  const data = project?.moduleData?.components as { __files?: Record<string, string> } | undefined;
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(data?.__files ?? {})) {
    const match = /^([^/]+)\.ya?ml$/.exec(path);
    if (match && !(match[1]! in out)) out[match[1]!] = content;
  }
  return out;
}

/** A component's text read as its file; an unreadable one is an empty component. */
export function readComponent(content: string | undefined): ComponentFile {
  try {
    const doc = parse(content ?? "");
    return isMap(doc) ? (doc as ComponentFile) : {};
  } catch {
    return {};
  }
}

export const writeComponentFile = (file: ComponentFile): string => stringify(file);

/** The key that stands for the text of the part `index` in `partsLook`. */
const textKey = (index: number) => `part:${index}` as LText["key"];

/**
 * The file's parts as a look of pieces, so the panel that edits a button's pieces edits a
 * component's: a text piece carries a key that stands for its place in the list (`partText`).
 */
export function partsLook(file: ComponentFile): Appearance {
  const parts: NonNullable<Appearance["parts"]> = [];
  (file.parts ?? []).forEach((raw, index) => {
    if (!isMap(raw)) return;
    const { image, label, ...rest } = raw;
    const placed = rest as Omit<NonNullable<Appearance["parts"]>[number], "image" | "label">;
    if (typeof image === "string") parts.push({ ...placed, image } as never);
    else parts.push({ ...placed, label: { key: textKey(index) } } as never);
  });
  return { parts };
}

/** The text of the piece a key of `partsLook` stands for, in `lang` when written per language. */
export function partText(file: ComponentFile, text: LText, lang: string): string {
  const index = Number(String(text.key).slice("part:".length));
  const part = file.parts?.[index];
  const label = isMap(part) ? part.label : undefined;
  if (typeof label === "string") return label;
  if (isMap(label)) return typeof label[lang] === "string" ? (label[lang] as string) : "";
  return "";
}

/** The file after one edit of its pieces, as the panel of a button's pieces asks for it. */
export function editComponentParts(
  file: ComponentFile,
  op: PartsEdit,
  lang: string,
): ComponentFile {
  const parts = (file.parts ?? []).filter(isMap).map((part) => ({ ...part }));
  if (op.type === "addImage") parts.push({ image: op.asset });
  else if (op.type === "addLabel") parts.push({ label: "" });
  else if (op.type === "remove") parts.splice(op.index, 1);
  else if (op.type === "move") {
    const [moved] = parts.splice(op.index, 1);
    if (moved) parts.splice(Math.max(0, Math.min(parts.length, op.to)), 0, moved);
  } else if (op.type === "patch") {
    const part = parts[op.index];
    if (!part) return file;
    for (const [key, value] of Object.entries(op.patch)) {
      if (value === undefined) Reflect.deleteProperty(part, key);
      else part[key] = value;
    }
  } else if (op.type === "text") {
    const part = parts[op.index];
    if (!part) return file;
    part.label = isMap(part.label) ? { ...part.label, [lang]: op.value } : op.value;
  }
  return { ...file, parts };
}

/** The file with the parameter `name` declared, changed or (with `null`) removed. */
export function setComponentParam(
  file: ComponentFile,
  name: string,
  spec: { type: "text" | "image" | "choice"; default?: string; values?: unknown } | null,
): ComponentFile {
  const params = { ...(file.params ?? {}) };
  if (spec === null) Reflect.deleteProperty(params, name);
  else
    params[name] = {
      type: spec.type,
      ...(spec.default !== undefined && spec.default !== "" ? { default: spec.default } : {}),
      // A choice keeps the names it offers: a list, or a map to what each writes.
      ...(spec.type === "choice" ? { values: spec.values ?? [] } : {}),
    };
  const { params: _, ...rest } = file;
  return Object.keys(params).length ? { params, ...rest } : rest;
}

/** Where a component is used. */
export interface ComponentUse {
  menuId: string;
  elementId: string;
}

/**
 * The buttons of the Project's menus that name its component `name`: by the bare name or by
 * the Project's folder. A common one of the same name is told apart by `artisan:`.
 */
export function componentUses(project: Project | undefined, name: string): ComponentUse[] {
  if (!project) return [];
  const folder = project.diskId ?? project.id;
  const names = new Set([name, `${folder}:${name}`]);
  const out: ComponentUse[] = [];
  for (const menu of menusOf(project))
    for (const layer of menu.layers)
      for (const element of layer.elements) {
        const named = [element.display, ...element.states].some((look) => {
          const c = look.component;
          return c !== undefined && names.has(typeof c === "string" ? c : c.name);
        });
        if (named) out.push({ menuId: menu.id, elementId: element.id });
      }
  return out;
}
