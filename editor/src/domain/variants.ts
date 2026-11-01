// A module's variants in the editor (design `variantes-modules` §9): every variant is loaded
// beside the module's own Documents; "View as <variant>" puts that variant's versions in
// `Project.documents`, where every editor, the canvas and the previews already look, and keeps
// the module's versions they cover aside until the view ends. Every function here works in
// place on a Project (an immer draft in the store), except `withModuleView`.
import { newI18nKey } from "@/lib/i18n";
import { moveLTextKey } from "@/lib/i18nKeys";
import { current, isDraft } from "immer";
import { documentLTextSites } from "./documentKindVisitors";
import { gcDocumentLTexts } from "./i18nSites";
import type {
  Command,
  CommandNode,
  Document,
  I18nKey,
  Project,
  ProjectVariants,
  VariantRule,
} from "./types";

/**
 * The kinds a variant may hold a version of. A command's version changes only what runs
 * (its steps, `requirements`, `fallback`): what is registered stays the module's.
 */
export const VARIANT_KINDS: readonly string[] = ["menu", "dialog", "command"];

/** A variant name: a folder name (`DocumentLayout`'s slug). */
export const VARIANT_NAME = /^[a-z0-9][a-z0-9_-]*$/;

export function variantNames(project: Project): string[] {
  return project.variants?.names ?? [];
}

/** The variant shown on the canvas, undefined for the module's own Documents. */
export function viewedVariant(project: Project): string | undefined {
  return project.variants?.view?.variant;
}

/**
 * Where the Document shown for (kind, id) comes from in the current view: the viewed
 * variant's name when it has its own version, undefined when it is the module's.
 */
export function versionOf(project: Project, kind: string, id: string): string | undefined {
  const view = project.variants?.view;
  return view?.shown[kind]?.includes(id) ? view.variant : undefined;
}

/** The variants holding their own version of (kind, id), the viewed one included. */
export function variantsHaving(project: Project, kind: string, id: string): string[] {
  const v = project.variants;
  if (!v) return [];
  return v.names.filter((name) =>
    v.view?.variant === name
      ? (v.view.shown[kind] ?? []).includes(id)
      : (v.documents[name]?.[kind] ?? []).some((d) => d.id === id),
  );
}

/**
 * Gives the texts of [doc] keys of their own. `copy`: the values are copied (the Document is
 * a new version, the original keeps its keys); otherwise the keys move. `all`: random keys too
 * (a copy must share none); otherwise only those at their canonical site (`menus.<id>.…`), the
 * ones an edit of another Document of the same id could mint again.
 */
function ownKeys(project: Project, kind: string, doc: Document, copy: boolean): void {
  for (const site of documentLTextSites(kind, doc)) {
    const key = site.lText.key;
    const canonical = key === site.key;
    if (!canonical && !(copy && key.startsWith("lt_"))) continue;
    const fresh = newI18nKey();
    if (copy) {
      const value = project.i18nKeys[key];
      if (value) project.i18nKeys[fresh] = { ...value };
      site.lText.key = fresh as I18nKey;
    } else moveLTextKey(project, site.lText, fresh);
  }
}

/** Shows [variant] on the canvas, or the module's own Documents when undefined. */
export function showVariant(project: Project, variant: string | undefined): void {
  const v = project.variants;
  if (!v) return;
  if (v.view) {
    const { variant: shownName, shown, hidden } = v.view;
    const own: Record<string, Document[]> = {};
    for (const kind of new Set([...Object.keys(shown), ...Object.keys(hidden)])) {
      const ids = new Set(shown[kind] ?? []);
      const docs = project.documents[kind] ?? [];
      const back = new Map((hidden[kind] ?? []).map((d) => [d.id, d]));
      const kept: Document[] = [];
      own[kind] = [];
      for (const doc of docs) {
        if (!ids.has(doc.id)) {
          kept.push(doc);
          continue;
        }
        ownKeys(project, kind, doc, false);
        own[kind].push(doc);
        const original = back.get(doc.id);
        if (original) {
          kept.push(original);
          back.delete(doc.id);
        }
      }
      // A version deleted in the view: the module's Document comes back.
      kept.push(...back.values());
      project.documents[kind] = kept;
    }
    v.documents[shownName] = own;
    v.view = undefined;
  }
  if (!variant || !v.names.includes(variant)) return;
  const shown: Record<string, string[]> = {};
  const hidden: Record<string, Document[]> = {};
  for (const [kind, docs] of Object.entries(v.documents[variant] ?? {})) {
    project.documents[kind] ??= [];
    const list = project.documents[kind];
    shown[kind] = [];
    hidden[kind] = [];
    for (const doc of docs) {
      const at = list.findIndex((d) => d.id === doc.id);
      if (at >= 0) {
        const original = list[at]!;
        ownKeys(project, kind, original, false);
        hidden[kind].push(original);
        list[at] = kind === "command" ? onModuleCommand(project, original, doc) : doc;
      } else list.push(doc);
      shown[kind].push(doc.id);
    }
  }
  delete v.documents[variant];
  v.view = { variant, shown, hidden };
}

/** The steps a command's version may change, kept in a node's `wire`. */
const COMMAND_STEP_WIRE = ["requirements", "fallback"];

const plain = <T>(v: T): T => structuredClone(isDraft(v) ? current(v) : v);

/**
 * A command's version as shown: the module's command (name, aliases, arguments, permission,
 * sub-commands, as it is now) running the version's steps, node by node by name.
 */
function onModuleCommand(project: Project, module: Document, version: Document): Document {
  const { folder: _moduleFolder, ...out } = plain(module) as Command;
  ownKeys(project, "command", out as Command, true);
  graftSteps(out, plain(version) as Command);
  const folder = (version as Command).folder;
  return folder === undefined ? out : { ...out, folder };
}

function graftSteps(node: CommandNode, version: CommandNode): void {
  node.steps = version.steps;
  const wire = Object.fromEntries(
    Object.entries(node.wire ?? {}).filter(([key]) => !COMMAND_STEP_WIRE.includes(key)),
  );
  for (const key of COMMAND_STEP_WIRE)
    if (version.wire && key in version.wire) wire[key] = version.wire[key];
  node.wire = Object.keys(wire).length > 0 ? wire : undefined;
  for (const sub of node.subcommands ?? []) {
    const twin = version.subcommands?.find(
      (s) => s.name.trim().toLowerCase() === sub.name.trim().toLowerCase(),
    );
    if (twin) graftSteps(sub, twin);
  }
}

/** [project] as the files hold it: the module's own Documents in place, a copy when a variant is shown. */
export function withModuleView(project: Project): Project {
  if (!project.variants?.view) return project;
  const copy = structuredClone(project);
  showVariant(copy, undefined);
  return copy;
}

/**
 * The viewed variant gets its own version of (kind, id), a copy of the module's, its texts
 * under keys of their own. False when nothing is viewed or the version exists already.
 */
export function createVersion(project: Project, kind: string, id: string): boolean {
  const view = project.variants?.view;
  if (!view || !VARIANT_KINDS.includes(kind) || view.shown[kind]?.includes(id)) return false;
  const list = project.documents[kind] ?? [];
  const at = list.findIndex((d) => d.id === id);
  if (at < 0) return false;
  const original = list[at]!;
  // On a store draft, the Document is a proxy structuredClone refuses.
  const copy = structuredClone(isDraft(original) ? current(original) : original) as Document;
  ownKeys(project, kind, copy, true);
  list[at] = copy;
  view.hidden[kind] = [...(view.hidden[kind] ?? []), original];
  view.shown[kind] = [...(view.shown[kind] ?? []), id];
  return true;
}

/** The viewed variant drops its version of (kind, id): the module's comes back. */
export function dropVersion(project: Project, kind: string, id: string): boolean {
  const view = project.variants?.view;
  if (!view?.shown[kind]?.includes(id)) return false;
  const list = project.documents[kind] ?? [];
  const at = list.findIndex((d) => d.id === id);
  const hidden = view.hidden[kind] ?? [];
  const h = hidden.findIndex((d) => d.id === id);
  if (at >= 0) {
    gcDocumentLTexts(project, kind, list[at]!);
    if (h >= 0) list[at] = hidden[h]!;
    else list.splice(at, 1);
  }
  if (h >= 0) hidden.splice(h, 1);
  view.shown[kind] = view.shown[kind]!.filter((x) => x !== id);
  return true;
}

/** A new variant, with a rule that is off until the admin turns it on. */
export function addVariant(project: Project, name: string): boolean {
  if (!VARIANT_NAME.test(name)) return false;
  project.variants ??= { rules: [], names: [], documents: {} };
  const v: ProjectVariants = project.variants;
  if (v.names.includes(name)) return false;
  v.names.push(name);
  v.rules.push({ variant: name, enabled: false });
  return true;
}

/** Removes a variant: its versions, its rules. */
export function removeVariant(project: Project, name: string): void {
  const v = project.variants;
  if (!v?.names.includes(name)) return;
  if (v.view?.variant === name) showVariant(project, undefined);
  for (const [kind, docs] of Object.entries(v.documents[name] ?? {}))
    for (const doc of docs) gcDocumentLTexts(project, kind, doc);
  delete v.documents[name];
  v.names = v.names.filter((n) => n !== name);
  v.rules = v.rules.filter((r) => r.variant !== name);
}

export function setVariantRules(project: Project, rules: VariantRule[]): void {
  if (!project.variants) return;
  project.variants.rules = rules.filter((r) => project.variants!.names.includes(r.variant));
}

// --- variants.yml -------------------------------------------------------------------------

export const VARIANTS_SCHEMA = "variants/v1";

/** `variants.yml` → rules; an unreadable rule is left out (the plugin reports it). */
export function rulesFromYaml(raw: unknown): VariantRule[] {
  const list = (raw as { rules?: unknown } | null)?.rules;
  if (!Array.isArray(list)) return [];
  return list.flatMap((r): VariantRule[] => {
    if (!r || typeof r !== "object") return [];
    const m = r as Record<string, unknown>;
    if (typeof m.variant !== "string" || !m.variant) return [];
    const when = (m.when && typeof m.when === "object" ? m.when : {}) as Record<string, unknown>;
    return [
      {
        ...(typeof m.id === "string" ? { id: m.id } : {}),
        variant: m.variant,
        enabled: m.enabled !== false,
        ...(when.client === "bedrock" || when.client === "java" ? { client: when.client } : {}),
        ...(typeof when.has_pack === "boolean" ? { hasPack: when.has_pack } : {}),
        ...(typeof when.permission === "string" ? { permission: when.permission } : {}),
        ...(when.condition !== undefined ? { condition: when.condition } : {}),
      },
    ];
  });
}

export function rulesToYaml(rules: VariantRule[]): Record<string, unknown> {
  return {
    schema: VARIANTS_SCHEMA,
    rules: rules.map((r) => {
      const when: Record<string, unknown> = {};
      if (r.client) when.client = r.client;
      if (r.hasPack !== undefined) when.has_pack = r.hasPack;
      if (r.permission) when.permission = r.permission;
      if (r.condition !== undefined) when.condition = r.condition;
      return {
        ...(r.id ? { id: r.id } : {}),
        variant: r.variant,
        ...(r.enabled ? {} : { enabled: false }),
        ...(Object.keys(when).length > 0 ? { when } : {}),
      };
    }),
  };
}
