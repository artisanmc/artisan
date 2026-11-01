import { sha256Hex } from "../../sha256";

/**
 * The title a Bedrock player receives for a menu the Bedrock pack styles.
 * Mirrored by `BedrockTitle.kt` in the plugin: the two must agree byte for byte.
 *
 *   MARKER  key(2)  [button(1) state(1)]*  [text field]*
 *
 * Every control character is in U+F800..U+F8FE, a page the pack draws blank
 * (`font/glyph_F8.png`), so a client without the pack sees nothing readable
 * and a client with it sees the fields the JSON UI cuts out of the title.
 *
 * - The key names the menu: 2 characters from the hash of `project:menu`, so
 *   the editor and the plugin compute it without any index to synchronise.
 * - Each image button carries its index then the appearance chosen at render
 *   time, from disjoint ranges so that `button state` pairs never read across
 *   two buttons. The JSON UI only needs a "contains" check for them.
 * - Text layers follow, each exactly a fixed number of UTF-8 **bytes**: the
 *   JSON UI's `'%.Ns'` keeps the first N bytes, not characters (checked in
 *   game: a character offset cut the 3-byte key in half and the field never
 *   rendered). A field is its text cut at a character boundary, then filler
 *   the JSON UI removes before showing it (spaces would count in a centred
 *   line and wrap it): 3-byte [PAD] characters, and 2-byte [PAD2] ones for
 *   the bytes a [PAD] cannot fill.
 */
export const BEDROCK_MARKER = "";
const KEY_BASE = 0xf880;
const KEY_RANGE = 0x7f;
const BUTTON_BASE = 0xf800;
export const BUTTON_MAX = 64;
const STATE_BASE = 0xf840;
export const STATE_MAX = 64;
/** UTF-8 bytes of a `text` / `plain` layer field, and of a `textarea` field. */
export const TEXT_FIELD = 64;
export const TEXTAREA_FIELD = 192;
/** Fills a field after its text; the pack strips it (`bedrockUi.ts`). */
export const BEDROCK_PAD = "\uF8FE";
/** Fills the 2 or 4 bytes a 3-byte [BEDROCK_PAD] cannot; also stripped by the pack. */
export const BEDROCK_PAD2 = "\u00A0";
/** UTF-8 bytes of every control character (all in U+F800..U+F8FF). */
const CONTROL_BYTES = 3;

/** The 2-character key of a menu, from the folder name of its project. */
export function bedrockMenuKey(projectId: string, menuId: string, variant?: string): string {
  // A variant's menu hashes `project:menu@variant` (`BedrockTitle.key` in paper).
  const seed = variant ? `${projectId}:${menuId}@${variant}` : `${projectId}:${menuId}`;
  const hex = sha256Hex(new TextEncoder().encode(seed));
  const b0 = Number.parseInt(hex.slice(0, 2), 16);
  const b1 = Number.parseInt(hex.slice(2, 4), 16);
  return String.fromCodePoint(KEY_BASE + (b0 % KEY_RANGE), KEY_BASE + (b1 % KEY_RANGE));
}

/** The `button state` pair of image button `index` in appearance `state`. */
export function bedrockButtonPair(index: number, state: number): string {
  return String.fromCodePoint(BUTTON_BASE + index, STATE_BASE + state);
}

/** Byte offset of text field `index` in a title with `buttons` image buttons. */
export function bedrockFieldOffset(buttons: number, fields: number[], index: number): number {
  let offset = CONTROL_BYTES * (1 + 2 + 2 * buttons);
  for (let i = 0; i < index; i++) offset += fields[i] ?? 0;
  return offset;
}

/** `text` as a field of exactly `bytes` UTF-8 bytes: cut at a character boundary, then padded. */
export function bedrockField(text: string, bytes: number): string {
  const encoder = new TextEncoder();
  let out = "";
  let used = 0;
  for (const ch of text) {
    const size = encoder.encode(ch).length;
    if (used + size > bytes) break;
    out += ch;
    used += size;
  }
  return out + bedrockPadding(bytes - used);
}

/**
 * `free` bytes of filler the pack strips: [BEDROCK_PAD] (3 bytes), with one or two
 * [BEDROCK_PAD2] (2 bytes) for the rest, so no space is left to shift a centred line.
 * Only a single free byte has to stay a space.
 */
function bedrockPadding(free: number): string {
  const rest = free % CONTROL_BYTES;
  if (rest === 0) return BEDROCK_PAD.repeat(free / CONTROL_BYTES);
  if (rest === 2) return BEDROCK_PAD.repeat((free - 2) / CONTROL_BYTES) + BEDROCK_PAD2;
  if (free === 1) return " ";
  return BEDROCK_PAD.repeat((free - 4) / CONTROL_BYTES) + BEDROCK_PAD2 + BEDROCK_PAD2;
}
