import { parse } from "yaml";
import {
  type ItemEnchant,
  type ItemHideFlag,
  normalizeColor,
  normalizeEnchantId,
  parseHideFlags,
} from "./itemAdvanced";

/**
 * Reads the details out of a captured item's `stackYaml` — the Bukkit-serialized
 * ItemStack the plugin writes verbatim to `items/<id>.yml`.
 *
 * Two shapes reach us and both are supported:
 *  - legacy Bukkit ConfigurationSerialization: `type` / `amount` / `meta{…}`
 *  - modern Paper data components: `id` / `count` / `components{…}`
 *
 * Everything is best-effort: an unreadable stack yields an empty result rather
 * than an exception, because a dangling or exotic capture must not break the
 * editor. This is a display/extraction aid, not a validator.
 */

export interface CapturedStackDetails {
  /** Vanilla material name (uppercase) or a custom ref like `nexo:<id>`. */
  material?: string;
  count?: number;
  name?: string;
  lore?: string[];
  enchants?: ItemEnchant[];
  /** Glint override carried by the stack itself, independent of `enchants`. */
  enchanted?: boolean;
  customModelData?: string;
  unbreakable?: boolean;
  hide?: ItemHideFlag[];
  color?: string;
  /** Base64 skin payload of a textured player head. */
  headTexture?: string;
}

type Dict = Record<string, unknown>;

function asDict(v: unknown): Dict | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Dict) : undefined;
}

/**
 * Best-effort SNBT → JSON. Minecraft's own notation is close to JSON but not
 * JSON: keys are bare (`{minecraft:sharpness:5}`) and numbers carry a type
 * suffix (`5s`, `1b`, `3L`, `1.0f`). Only used as a fallback once strict
 * `JSON.parse` has failed.
 */
function snbtToJson(snbt: string): string {
  return snbt
    .replace(/([{[,]\s*)([A-Za-z_][\w.+-]*(?::[\w.+-]+)?)\s*:/g, '$1"$2":')
    .replace(/(-?\d+(?:\.\d+)?)[bslfdBSLFD](?=\s*[,}\]])/g, "$1");
}

/**
 * A data component's value may arrive as a nested map OR as an encoded string
 * — Paper serializes components as JSON/SNBT text inside the YAML, which is
 * how a real capture of an enchanted sword looks. Returns the value untouched
 * when it is not an encoded container, so text components (`custom_name`) keep
 * their string form for [plainText].
 */
function decodeComponent(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return raw;
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to the SNBT tolerance pass.
  }
  try {
    return JSON.parse(snbtToJson(trimmed));
  } catch {
    return raw;
  }
}

/**
 * Minecraft text components arrive JSON-encoded inside the YAML. Pull the
 * readable text out of `{"text":…,"extra":[…]}`, or pass a plain string through.
 */
function plainText(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return trimmed;
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
  const walk = (node: unknown): string => {
    if (typeof node === "string") return node;
    if (Array.isArray(node)) return node.map(walk).join("");
    const d = asDict(node);
    if (!d) return "";
    const self = typeof d.text === "string" ? d.text : "";
    const extra = Array.isArray(d.extra) ? d.extra.map(walk).join("") : "";
    return self + extra;
  };
  const text = walk(json);
  return text || trimmed;
}

function toCount(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
  // 1 is the default — stating it would add noise to the extracted form.
  return Number.isFinite(n) && n > 1 ? Math.floor(n) : undefined;
}

function enchantList(raw: unknown): ItemEnchant[] | undefined {
  const map = asDict(raw);
  if (!map) return undefined;
  const out: ItemEnchant[] = [];
  for (const [id, level] of Object.entries(map)) {
    const n = typeof level === "number" ? level : Number(level);
    if (!Number.isFinite(n)) continue;
    out.push({ id: normalizeEnchantId(id), level: Math.max(1, Math.floor(n)) });
  }
  return out.length > 0 ? out : undefined;
}

/** `minecraft:diamond_sword` → `DIAMOND_SWORD`. */
function materialFromId(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  return raw
    .trim()
    .replace(/^minecraft:/, "")
    .toUpperCase();
}

// Modern data-component form

function readComponents(components: Dict, out: CapturedStackDetails): void {
  const name =
    plainText(components["minecraft:custom_name"]) ?? plainText(components["minecraft:item_name"]);
  if (name) out.name = name;

  const lore = decodeComponent(components["minecraft:lore"]);
  if (Array.isArray(lore)) {
    const lines = lore.map((l) => plainText(l) ?? "").filter((l) => l !== "");
    if (lines.length > 0) out.lore = lines;
  }

  // 1.21.5 dropped the `levels` wrapper; both spellings are in the wild.
  const ench = asDict(decodeComponent(components["minecraft:enchantments"]));
  if (ench) {
    const enchants = enchantList(ench.levels ?? ench);
    if (enchants) out.enchants = enchants;
  }

  if (components["minecraft:enchantment_glint_override"] === true) out.enchanted = true;

  // The component exists (even as an empty map) iff the item is unbreakable.
  if ("minecraft:unbreakable" in components) out.unbreakable = true;

  const cmd = decodeComponent(components["minecraft:custom_model_data"]);
  const cmdDict = asDict(cmd);
  if (typeof cmd === "number" || typeof cmd === "string") {
    out.customModelData = String(cmd);
  } else if (cmdDict) {
    const strings = cmdDict.strings;
    const floats = cmdDict.floats;
    if (Array.isArray(strings) && strings.length > 0) {
      out.customModelData = String(strings[0]);
    } else if (Array.isArray(floats) && floats.length > 0) {
      // Whole floats are the common case; keep them integer-looking.
      const n = Number(floats[0]);
      out.customModelData = Number.isInteger(n) ? String(n) : String(floats[0]);
    }
  }

  const dyed = decodeComponent(components["minecraft:dyed_color"]);
  const color = normalizeColor(typeof dyed === "object" ? asDict(dyed)?.rgb : dyed);
  if (color) out.color = color;

  const profile = asDict(decodeComponent(components["minecraft:profile"]));
  const properties = profile?.properties;
  if (Array.isArray(properties)) {
    for (const prop of properties) {
      const p = asDict(prop);
      if (p?.name === "textures" && typeof p.value === "string") {
        out.headTexture = p.value;
        break;
      }
    }
  }

  // Custom-item plugins stamp their id in custom_data; it's a better material
  // ref than the vanilla base item the stack actually is.
  const customData = asDict(decodeComponent(components["minecraft:custom_data"]));
  if (customData) {
    for (const ns of ["nexo", "oraxen", "itemsadder"]) {
      const nested = asDict(customData[ns]);
      const id = customData[`${ns}:id`] ?? nested?.id;
      if (typeof id === "string" && id.trim()) {
        out.material = `${ns}:${id.trim()}`;
        break;
      }
    }
  }
}

// Legacy Bukkit form

function readLegacyMeta(meta: Dict, out: CapturedStackDetails): void {
  const name = plainText(meta["display-name"]);
  if (name) out.name = name;

  const lore = meta.lore;
  if (Array.isArray(lore)) {
    const lines = lore.map((l) => plainText(l) ?? "").filter((l) => l !== "");
    if (lines.length > 0) out.lore = lines;
  }

  const enchants = enchantList(meta.enchants);
  if (enchants) out.enchants = enchants;

  if (meta.Unbreakable === true || meta.unbreakable === true) out.unbreakable = true;

  const cmd = meta["custom-model-data"];
  if (typeof cmd === "number" || (typeof cmd === "string" && cmd.trim() !== "")) {
    out.customModelData = String(cmd);
  }

  const hide = parseHideFlags(meta.ItemFlags);
  if (hide) out.hide = hide;

  // `color: {==: Color, RED: 255, GREEN: 0, BLUE: 0}`, or a packed int.
  const rawColor = meta.color;
  const colorDict = asDict(rawColor);
  if (colorDict && typeof colorDict.RED === "number") {
    const packed =
      ((colorDict.RED as number) << 16) |
      ((Number(colorDict.GREEN) || 0) << 8) |
      (Number(colorDict.BLUE) || 0);
    const color = normalizeColor(packed);
    if (color) out.color = color;
  } else {
    const color = normalizeColor(rawColor);
    if (color) out.color = color;
  }

  const skull = asDict(meta["skull-owner"]);
  const properties = asDict(skull?.properties)?.textures ?? skull?.properties;
  if (Array.isArray(properties)) {
    for (const prop of properties) {
      const value = asDict(prop)?.value;
      if (typeof value === "string") {
        out.headTexture = value;
        break;
      }
    }
  }
}

/**
 * Parse a captured item's `stackYaml` into editable detail fields.
 * Returns `{}` for anything unreadable — never throws.
 */
export function parseCapturedStack(stackYaml: string): CapturedStackDetails {
  let doc: unknown;
  try {
    doc = parse(stackYaml);
  } catch {
    return {};
  }
  const root = asDict(doc);
  if (!root) return {};
  // Canonical form wraps the stack under `item:`; a bare `==:` document is tolerated.
  const stack = asDict(root.item) ?? root;

  const out: CapturedStackDetails = {};
  const material = materialFromId(stack.id) ?? materialFromId(stack.type);
  if (material) out.material = material;
  const count = toCount(stack.count ?? stack.amount);
  if (count !== undefined) out.count = count;

  const components = asDict(stack.components);
  if (components) readComponents(components, out);
  const meta = asDict(stack.meta);
  if (meta) readLegacyMeta(meta, out);

  return out;
}

/**
 * Memoized [parseCapturedStack], keyed by the YAML itself. Render paths call
 * this once per slot per frame; the stacks are small, immutable and few.
 */
const CACHE = new Map<string, CapturedStackDetails>();

export function capturedStackDetails(stackYaml: string): CapturedStackDetails {
  const hit = CACHE.get(stackYaml);
  if (hit) return hit;
  const parsed = parseCapturedStack(stackYaml);
  CACHE.set(stackYaml, parsed);
  return parsed;
}
