import { newCommandId, newElementId, newLayerId, newMenuId } from "@/domain/ids";
import type {
  Action,
  Appearance,
  ClickHandler,
  ClickType,
  Command,
  Element,
  Layer,
  Menu,
  MenuId,
} from "@/domain/types";

const CLIPBOARD_KIND = "interfaze.clipboard" as const;
export const CLIPBOARD_VERSION = 2;

export interface ElementCopy {
  /** Menu the element was copied from — used as a fallback paste target. */
  sourceMenuId: MenuId;
  element: Element;
}

export interface ClipboardPayload {
  kind: typeof CLIPBOARD_KIND;
  version: number;
  menus: Menu[];
  commands: Command[];
  elements: ElementCopy[];
}

/** In-memory fallback when the system clipboard isn't available (permission denied, file:// origin, etc). */
let memoryClipboard: ClipboardPayload | null = null;

const isPayload = (v: unknown): v is ClipboardPayload =>
  typeof v === "object" &&
  v !== null &&
  (v as { kind: unknown }).kind === CLIPBOARD_KIND &&
  typeof (v as { version: unknown }).version === "number" &&
  Array.isArray((v as { menus: unknown }).menus) &&
  Array.isArray((v as { commands: unknown }).commands);

export async function writeClipboard(payload: ClipboardPayload): Promise<void> {
  memoryClipboard = payload;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(JSON.stringify(payload));
    }
  } catch {
    // memoryClipboard already set.
  }
}

export async function readClipboard(): Promise<ClipboardPayload | null> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText();
      const parsed = JSON.parse(text);
      if (isPayload(parsed)) return normalize(parsed);
    }
  } catch {
    // fallthrough to memory clipboard
  }
  return memoryClipboard;
}

/** Backfill missing fields so v1 payloads behave like v2. */
const normalize = (p: ClipboardPayload): ClipboardPayload => ({
  ...p,
  elements: Array.isArray(p.elements) ? p.elements : [],
});

/**
 * Deep-clone menus and commands with brand-new ids on every menu, command,
 * layer, and element. Within the rewritten set, open_menu actions that
 * pointed at one of the original menu ids are also rewritten so internal
 * references stay intact after the paste. open_menu actions targeting
 * something OUTSIDE the rewrite set are left as-is — assertPackHermetic
 * will catch them in the destination pack and reject the paste.
 */
export function rewriteIds(input: {
  menus: Menu[];
  commands: Command[];
  elements?: ElementCopy[];
}): { menus: Menu[]; commands: Command[]; elements: ElementCopy[] } {
  const menuRemap = new Map<MenuId, MenuId>();
  for (const m of input.menus) menuRemap.set(m.id, newMenuId());

  const remapAction = (a: Action): Action => {
    if (a.type === "open_menu") {
      const target = menuRemap.get(a.menuId);
      return target ? { ...a, menuId: target } : a;
    }
    return a;
  };
  const remapHandler = (h: ClickHandler): ClickHandler => ({
    ...h,
    actions: h.actions.map(remapAction),
    fallback: h.fallback ? h.fallback.map(remapAction) : undefined,
  });
  const remapAppearance = (a: Appearance): Appearance => {
    if (!a.click) return a;
    const click: Partial<Record<ClickType, ClickHandler>> = {};
    for (const [key, handler] of Object.entries(a.click) as [ClickType, ClickHandler][]) {
      click[key] = remapHandler(handler);
    }
    return { ...a, click };
  };
  const remapElement = (el: Element): Element => ({
    ...el,
    id: newElementId(),
    appearances: el.appearances.map(remapAppearance),
  });
  const remapLayer = (l: Layer): Layer => ({
    ...l,
    id: newLayerId(),
    elements: l.elements.map(remapElement),
  });

  const menus = input.menus.map((m) => ({
    ...m,
    id: menuRemap.get(m.id)!,
    layers: m.layers.map(remapLayer),
  }));
  const commands = input.commands.map((c) => ({
    ...c,
    id: newCommandId(),
    actions: c.actions.map(remapAction),
  }));
  const elements = (input.elements ?? []).map<ElementCopy>((ec) => ({
    sourceMenuId: ec.sourceMenuId,
    element: remapElement(ec.element),
  }));

  return { menus, commands, elements };
}
