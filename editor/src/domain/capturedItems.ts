import { parse, stringify } from "yaml";
import { capturedStackDetails, parseCapturedStack } from "./capturedStack";
import type { CapturedItem, Project } from "./types";

/** Material-ref prefix for captured items (`item:<capturedItemId>`). */
export const CAPTURED_ITEM_REF_PREFIX = "item:";

export interface DisplayRef {
  material: string;
  /** basehead:<base64> when the captured stack is a textured player head. */
  head?: string;
  enchanted?: boolean;
}

/**
 * Resolve a material ref for editor display. `item:<id>` refs expand to the
 * captured item's display descriptor (material possibly a custom ref like
 * `nexo:…`, head texture, glint); every other ref (vanilla, `nexo:`,
 * placeholders) passes through untouched. A dangling `item:` ref degrades to
 * the bare ref string (non-hermetic — the runtime ignores, the editor shows a
 * letter tile).
 */
/** What a referenced item says about itself, as the runtime will render it. */
export interface CapturedPresentation {
  /** MiniMessage, like an element's own title and lore. */
  name?: string;
  lore: string[];
}

/**
 * The name and lore a `item:<id>` ref brings on its own. The runtime builds the
 * stack first and only then applies the appearance, so the captured name shows
 * whenever the element declares no title, and the captured lore always shows —
 * the element's lines are appended to it (MenuRenderer.buildItem). The canvas
 * preview reads this so it shows what the player will actually see.
 *
 * Empty for every other ref (vanilla, `nexo:`, placeholders) and for a dangling
 * one: non-hermetic, the editor never invents what it can't resolve.
 */
export function capturedPresentation(
  project: Project,
  ref: string | undefined,
): CapturedPresentation {
  if (!ref?.startsWith(CAPTURED_ITEM_REF_PREFIX)) return { lore: [] };
  const id = ref.slice(CAPTURED_ITEM_REF_PREFIX.length);
  const item = (project.capturedItems ?? []).find((c) => String(c.id) === id);
  if (!item) return { lore: [] };
  const stack = capturedStackDetails(item.stackYaml);
  // The descriptor is what the plugin derived at capture time; the serialized
  // stack is the ground truth and fills what the descriptor didn't carry.
  // Styled as the game draws them when the stack says how; plain otherwise.
  const name = stack.nameMini ?? item.display.name ?? stack.name;
  return { ...(name ? { name } : {}), lore: stack.loreMini ?? stack.lore ?? [] };
}

export function resolveDisplayRef(project: Project, ref: string): DisplayRef {
  if (!ref.startsWith(CAPTURED_ITEM_REF_PREFIX)) return { material: ref };
  const id = ref.slice(CAPTURED_ITEM_REF_PREFIX.length);
  const item = (project.capturedItems ?? []).find((c) => String(c.id) === id);
  if (!item) return { material: ref };
  // The descriptor is what the plugin derived at capture time; the serialized
  // stack is the ground truth and fills whatever the descriptor didn't carry
  // (older captures, or items written by a module rather than the capture panel).
  const stack = capturedStackDetails(item.stackYaml);
  const out: DisplayRef = { material: item.display.material ?? stack.material ?? ref };
  const headTexture = item.display.headTexture ?? stack.headTexture;
  if (headTexture) out.head = `basehead:${headTexture}`;
  if (item.display.enchanted || stack.enchanted || (stack.enchants?.length ?? 0) > 0) {
    out.enchanted = true;
  }
  return out;
}

/**
 * What an item ref shows, among the open projects: its material, then its head after a line
 * break when it has one. A string, so a store selector returning it stays stable. A ref that
 * names no captured item is its own material.
 */
export function capturedDisplay(projects: readonly Project[], ref: string): string {
  if (!ref.startsWith(CAPTURED_ITEM_REF_PREFIX)) return ref;
  const id = ref.slice(CAPTURED_ITEM_REF_PREFIX.length);
  const project = projects.find((p) => (p.capturedItems ?? []).some((c) => String(c.id) === id));
  if (!project) return ref;
  const display = resolveDisplayRef(project, ref);
  return display.head ? `${display.material}\n${display.head}` : (display.material ?? ref);
}

/**
 * The label and display descriptor an `items/<id>.yml` file yields on its own, with no
 * `.artisan/editor.yaml` entry: derived from the serialized stack (`parseCapturedStack`), then
 * the file's root `display:` block, beside `item:`, laid over it. The plugin reads only `item:`;
 * `display:` is where a descriptor the stack does not express lives (`withDescriptor`).
 */
export function derivedCapturedItem(
  id: string,
  stackYaml: string,
): Pick<CapturedItem, "name" | "display"> | null {
  const root = parseRoot(stackYaml);
  if (!root) return null;
  const stack = parseCapturedStack(stackYaml);
  const display: CapturedItem["display"] = {};
  if (stack.material) display.material = stack.material;
  if (stack.count !== undefined) display.count = stack.count;
  if (stack.name) display.name = stack.name;
  if (stack.headTexture) display.headTexture = stack.headTexture;
  // Real enchantments glint just as the explicit override does.
  if (stack.enchanted || (stack.enchants?.length ?? 0) > 0) display.enchanted = true;
  const own = root.display;
  if (own && typeof own === "object") Object.assign(display, own);
  // The capture panel's label, for an item the game names: its name, else its material.
  const name =
    typeof display.name === "string"
      ? display.name
      : typeof display.material === "string"
        ? display.material
        : id;
  return { name, display };
}

/**
 * Whether [item]'s descriptor says more than its file: a capture the plugin enriched (a custom
 * material the stack does not express). Those are written beside the stack (`withDescriptor`);
 * the rest is derived again on read. The label is never stored: it follows the descriptor.
 */
export function capturedItemNeedsDescriptor(item: CapturedItem): boolean {
  const derived = derivedCapturedItem(item.id, item.stackYaml);
  if (!derived) return true;
  return canonical(item.display) !== canonical(derived.display);
}

/**
 * [item]'s file with its descriptor as a root `display:` block after the stack, the stack's
 * bytes untouched (never re-serialized). Null when the file is not the canonical `item:` form:
 * the plugin reads a bare stack as a whole, a `display:` key would land inside it.
 */
export function withDescriptor(item: CapturedItem): string | null {
  const root = parseRoot(item.stackYaml);
  if (!root || !("item" in root) || "display" in root) return null;
  const display = Object.fromEntries(
    Object.entries(item.display).filter(([, v]) => v !== undefined),
  );
  return `${item.stackYaml.replace(/\n*$/, "\n")}${stringify({ display }, { lineWidth: 0 })}`;
}

function parseRoot(text: string): Record<string, unknown> | null {
  try {
    const root = parse(text);
    return root && typeof root === "object" && !Array.isArray(root)
      ? (root as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function canonical(display: CapturedItem["display"]): string {
  return JSON.stringify(
    Object.entries(display)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}
