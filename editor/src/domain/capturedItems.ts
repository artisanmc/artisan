import { capturedStackDetails } from "./capturedStack";
import type { Project } from "./types";

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
export function resolveDisplayRef(pack: Project, ref: string): DisplayRef {
  if (!ref.startsWith(CAPTURED_ITEM_REF_PREFIX)) return { material: ref };
  const id = ref.slice(CAPTURED_ITEM_REF_PREFIX.length);
  const item = (pack.capturedItems ?? []).find((c) => String(c.id) === id);
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
