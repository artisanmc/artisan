import { isLTextNode, walkStepTextSlots } from "@/domain/actionTextSlots";
import { normalizeDataSourceName } from "@/domain/dataModels";
import { commandsOf, menusOf } from "@/domain/documents";
import { appearanceAt } from "@/domain/element";
import {
  mintLTexts,
  rekeyDataSource,
  releaseLTexts,
  visitAppearanceLTexts,
  visitDataSourceLTexts,
  visitElementLTexts,
  visitStepLTexts,
} from "@/domain/i18nSites";
import type {
  Appearance,
  ClickType,
  CommandArg,
  CommandId,
  DataSource,
  DataSourceId,
  Dialog,
  Element,
  ElementId,
  I18nKey,
  Menu,
  MenuTitleLayer,
  Project,
  ProjectId,
  Step,
} from "@/domain/types";
import { slotCount } from "@/features/canvas/inventoryTypes";
import { createLText } from "@/lib/i18n";
import { clickHandlerKeyPrefix, elementLoreKey, elementTitleKey } from "@/lib/i18nKeys";
import { formatPositions, parsePositions } from "@/lib/positions";
import type { AccountState, AppearanceTarget } from "./types";

/**
 * Helpers shared by the account slices: they walk the immer draft and return live
 * references, so a mutation can splice in place.
 */
/**
 * Tiny helpers shared by the step-tree mutations. They walk the immer
 * draft and return live references so callers can splice in place.
 */
/**
 * Resolve an AppearanceTarget to its owning element inside the given project
 * draft. Null when the target doesn't exist.
 */
/**
 * Re-key every LText an appearance holds, copying the source values — so a copy
 * never shares translation keys with its original (editing one would silently
 * change the other).
 */
export function cloneAppearanceLTextsInto(project: Project, a: Appearance): void {
  if (a.title) {
    const src = project.i18nKeys[a.title.key];
    a.title = createLText(project, "", project.defaultLang);
    if (src) project.i18nKeys[a.title.key] = { ...src };
  }
  if (a.lore) {
    const src = project.i18nKeys[a.lore.key];
    a.lore = createLText(project, "", project.defaultLang);
    if (src) project.i18nKeys[a.lore.key] = { ...src };
  }
  if (a.click) {
    for (const handler of Object.values(a.click)) {
      if (handler) duplicateStepLTexts(project, handler.steps);
    }
  }
}

/**
 * Give every text of a copied Step tree its own fresh key, carrying the translations
 * over, so the copy and its source stop sharing entries. Folds over the text slots of
 * every declared action (core or module), like the i18n lifecycle does.
 */
export function duplicateStepLTexts(project: Project, steps: Step[]): void {
  for (const slot of walkStepTextSlots(steps, "")) {
    const node = slot.get();
    if (!isLTextNode(node)) continue;
    const src = project.i18nKeys[node.key];
    const fresh = createLText(project, "", project.defaultLang);
    if (src) project.i18nKeys[fresh.key] = { ...src };
    slot.set(fresh);
  }
}

export function findAppearanceOwner(project: Project, target: AppearanceTarget): Element | null {
  const menu = menusOf(project).find((m) => m.id === target.menuId);
  if (!menu) return null;
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      if (el.id === target.elementId) return el;
    }
  }
  return null;
}

/** The appearance an {@link AppearanceTarget} + index addresses: 0 is the
 *  element's display, N is its `states[N - 1]`. */
export function findAddressedAppearance(
  project: Project,
  target: AppearanceTarget,
  index: number,
): Appearance | undefined {
  const owner = findAppearanceOwner(project, target);
  return owner ? appearanceAt(owner, index) : undefined;
}

export function findElementHandler(
  draft: AccountState,
  projectId: ProjectId,
  target: AppearanceTarget,
  appearanceIndex: number,
  clickType: ClickType,
) {
  const project = draft.account.projects.find((p) => p.id === projectId);
  if (!project) return null;
  const owner = findAppearanceOwner(project, target);
  return (owner ? appearanceAt(owner, appearanceIndex) : undefined)?.click?.[clickType] ?? null;
}

/** Canonical i18n key/prefix for an appearance site. */
export const appearanceTitleKeyFor = (target: AppearanceTarget, appIdx: number) =>
  elementTitleKey(target.menuId as string, target.elementId as string, appIdx);
export const appearanceLoreKeyFor = (target: AppearanceTarget, appIdx: number) =>
  elementLoreKey(target.menuId as string, target.elementId as string, appIdx);
export const appearanceClickPrefixFor = (
  target: AppearanceTarget,
  appIdx: number,
  clickType: ClickType,
) => clickHandlerKeyPrefix(target.menuId as string, target.elementId as string, appIdx, clickType);

export function findCommand(draft: AccountState, projectId: ProjectId, commandId: CommandId) {
  const project = draft.account.projects.find((p) => p.id === projectId);
  if (!project) return null;
  return commandsOf(project).find((c) => c.id === commandId) ?? null;
}

export function touch(draft: AccountState, projectId: ProjectId) {
  const project = draft.account.projects.find((p) => p.id === projectId);
  if (project) project.updatedAt = new Date().toISOString();
}

/**
 * Per-mutation i18n key lifecycle, folded over the single project traversal in
 * `@/domain/i18nSites`. `allocStepLTexts` mints canonical keys for any step
 * action still holding the unallocated sentinel (`key === ""`); the `gc*`
 * family releases the keys of a removed subtree. Signatures are preserved so
 * the mutation call sites stay put — only the traversal moved out.
 */
export function allocStepLTexts(
  project: Project,
  steps: Step[],
  lang: string,
  keyPrefix: string,
): void {
  mintLTexts(project, visitStepLTexts(steps, keyPrefix), lang);
}
export function gcStepLTexts(project: Project, steps: Step[]): void {
  releaseLTexts(project, visitStepLTexts(steps, ""));
}
export function gcAppearanceLTexts(project: Project, appearance: Appearance): void {
  releaseLTexts(project, visitAppearanceLTexts(appearance, ""));
}
export function gcElementLTexts(project: Project, element: Element): void {
  releaseLTexts(project, visitElementLTexts("", element));
}

/**
 * With a hidden bottom, positions past the menu are player slots: when the menu
 * part resizes they follow it, so each button stays on the same player slot.
 */
export function shiftPlayerPositions(menu: Menu, oldSize: number, newSize: number): void {
  if (menu.playerInventory !== "hidden" || oldSize === newSize) return;
  const shift = (p: number) => (p >= oldSize ? p - oldSize + newSize : p);
  for (const el of menu.layers.flatMap((l) => l.elements)) {
    const positions = parsePositions(el.positions);
    if (positions.some((p) => p >= oldSize)) el.positions = formatPositions(positions.map(shift));
    for (const placement of el.places?.placements ?? [])
      placement.position = shift(placement.position);
  }
}

/** Auto slot range for a dropped paginated block: skip the first/last menu row when roomy. */
export function defaultIterateRange(menu: Menu): string {
  const total = slotCount(menu.inventoryType ?? "chest", menu.rows);
  if (total <= 18) return `0-${total - 1}`;
  return `9-${total - 10}`;
}

/** i18n keys held by the text-bearing title layers (text/plain/textarea) in a set. */
export function titleLayerKeys(layers: MenuTitleLayer[]): Set<I18nKey> {
  const keys = new Set<I18nKey>();
  for (const l of layers) {
    if ((l.kind === "text" || l.kind === "plain" || l.kind === "textarea") && l.value?.key) {
      keys.add(l.value.key);
    }
  }
  return keys;
}
/** Replace a single LText key inside a dialog (title/body/input/button label) — used by setDialogId. */
export function updateDialogLTextKey(dialog: Dialog, oldKey: I18nKey, newKey: I18nKey): void {
  if (dialog.title.key === oldKey) {
    dialog.title.key = newKey;
    return;
  }
  for (const body of dialog.body) {
    if (body.type === "text" && body.text.key === oldKey) {
      body.text.key = newKey;
      return;
    }
  }
  for (const input of dialog.inputs) {
    if (input.label.key === oldKey) {
      input.label.key = newKey;
      return;
    }
    if (input.type === "single_option") {
      for (const opt of input.options) {
        if (opt.label.key === oldKey) {
          opt.label.key = newKey;
          return;
        }
      }
    }
  }
  for (const btn of dialog.buttons) {
    if (btn.label.key === oldKey) {
      btn.label.key = newKey;
      return;
    }
    for (const site of visitStepLTexts(btn.steps, "")) {
      if (site.lText.key === oldKey) {
        site.lText.key = newKey;
        return;
      }
    }
  }
}

export function generateDataSourceId(): DataSourceId {
  return `ds_${Math.random().toString(36).slice(2, 10)}` as DataSourceId;
}

/** Mint sentinels and canonicalize every ltext across the project's Project sources. */
export function mintSourceLTexts(project: Project): void {
  for (const ds of project.dataSources ?? []) {
    mintLTexts(project, visitDataSourceLTexts(project, ds), project.defaultLang);
    rekeyDataSource(project, ds);
  }
}

/** Navigate a source's row (or config value) to the container at `path`. */
export function sourceValueContainer(
  ds: DataSource,
  row: number | null,
  path: (string | number)[],
): unknown {
  let current: unknown =
    ds.shape === "table" ? (row === null ? undefined : ds.rows[row]) : ds.value;
  for (const seg of path) {
    if (current === undefined || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[seg];
  }
  return current;
}

export function nextElementIdForMaterial(
  project: Project,
  material: string | undefined,
): ElementId {
  const base = (material ?? "button").toLowerCase();
  const prefix = `${base}_`;
  let max = 0;
  for (const menu of menusOf(project)) {
    for (const layer of menu.layers) {
      for (const el of layer.elements) {
        if (el.id.startsWith(prefix)) {
          const n = Number.parseInt(el.id.slice(prefix.length), 10);
          if (Number.isFinite(n) && n > max) max = n;
        }
      }
    }
  }
  return `${base}_${max + 1}` as ElementId;
}

export function nextAvailableName(existing: DataSource[], base: string): string {
  const normalizedBase = normalizeDataSourceName(base);
  if (!existing.some((d) => normalizeDataSourceName(d.name) === normalizedBase))
    return normalizedBase;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${normalizedBase}_${n}`;
    if (!existing.some((d) => normalizeDataSourceName(d.name) === candidate)) return candidate;
  }
  return `${normalizedBase}_${Date.now()}`;
}

/** Throws if any required arg follows an optional one. */
export function validateArgOrder(args: CommandArg[]): void {
  let seenOptional = false;
  for (const arg of args) {
    if (!arg.required) {
      seenOptional = true;
    } else if (seenOptional) {
      throw new Error(`required arg "${arg.name}" cannot follow an optional arg`);
    }
  }
}

/** Rekey canvasGroups membership when a Document id changes. */
export function rewriteCanvasGroupMembers(project: Project, oldId: string, newId: string) {
  for (const group of project.canvasGroups ?? []) {
    group.nodeIds = group.nodeIds.map((id) => (id === oldId ? newId : id));
  }
}

/** Rekey canvasEdges entries when a node id changes ("a->b" keys embed node ids). */
export function rewriteCanvasEdgeIds(project: Project, oldId: string, newId: string) {
  if (!project.canvasEdges) return;
  for (const key of Object.keys(project.canvasEdges)) {
    const [src, tgt] = key.split("->") as [string, string];
    if (src !== oldId && tgt !== oldId) continue;
    const newKey = `${src === oldId ? newId : src}->${tgt === oldId ? newId : tgt}`;
    project.canvasEdges[newKey] = project.canvasEdges[key]!;
    delete project.canvasEdges[key];
  }
}

/** Releases the text a Document owns before it leaves the project, through its kind's visitor. */
export { gcDocumentLTexts } from "@/domain/i18nSites";
