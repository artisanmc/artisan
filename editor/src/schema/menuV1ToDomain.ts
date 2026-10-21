import { readAdvanced } from "@/domain/itemAdvanced";
import type {
  AssetId,
  ClickHandler,
  ClickMap,
  ClickType,
  Appearance as DomainAppearance,
  ContextInput as DomainContextInput,
  Element as DomainElement,
  Layer as DomainLayer,
  Menu as DomainMenu,
  I18nKey,
  InventoryType,
  LText,
  MenuId,
  MenuTitleLayer,
  ProjectId,
  TextSize,
} from "@/domain/types";
import { INVENTORY_TYPES } from "@/features/canvas/inventoryTypes";
import { newI18nKey } from "@/lib/i18n";
import { makeStepConverter } from "./actionV1ToDomain";

const CLICK_TYPES: ClickType[] = ["left", "right", "shift_left", "shift_right", "middle"];
const TEXT_SIZES: TextSize[] = [8, 12, 16, 20, 24, 32];

// The menu/v1 wire object is parsed YAML (snake_case, loosely typed). We model
// it as a bag and reconcile each field explicitly into the domain shapes.
// biome-ignore lint/suspicious/noExplicitAny: untyped wire object — fields read by snake name
type Json = Record<string, any>;

export interface ImportResult {
  menu: DomainMenu;
  /** i18n keys allocated for literal text (to merge into project.i18nKeys by the caller). */
  i18nKeys: Record<string, Record<string, string>>;
  /** menu/v1 constructs without a domain equivalent (the domain is a subset of the plugin vocab). */
  unsupported: string[];
}

/**
 * True when a wire text value is a field-local `{ lang: text }` map (ADR
 * `field-local-translations`) — as opposed to an inline literal/ref string or a
 * legacy `{key}`/`{value}`/layer object. Structural text slots accept both.
 */
export function isLangMap(v: unknown): v is Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  if ("key" in o || "value" in o || "text" in o || "kind" in o) return false;
  const values = Object.values(o);
  return values.length > 0 && values.every((x) => typeof x === "string");
}

/** i18n bridge shared by the wire→domain converters (same contract as makeStepConverter). */
export interface I18nBridge {
  text: (raw: string | Record<string, string> | undefined) => LText;
  ref: (key: string) => LText;
  pushUnsupported: (s: string) => void;
}

/**
 * Standalone appearance converter (wire appearance → domain), shared by
 * menuV1ToDomain and the template/v1 import path of projectFromFiles.
 */
export function makeAppearanceConverter(bridge: I18nBridge): {
  appearance: (a: Json) => DomainAppearance;
} {
  const { text } = bridge;
  const { steps: parseSteps, ifArray } = makeStepConverter(bridge);

  function clickMap(click: Json | undefined): ClickMap | undefined {
    if (!click || typeof click !== "object") return undefined;
    const out: ClickMap = {};
    for (const ct of CLICK_TYPES) {
      const handler = click[ct] as Json | string | undefined;
      if (!handler) continue;
      // String = legacy DSL ; `{steps:"<dsl>"}` = legacy wrapped ; map/list = keyed.
      out[ct] = { steps: parseSteps(handler) } satisfies ClickHandler;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  // menu/v1 lore is `string[]`; domain lore is a single LText (lines joined by
  // `\n`). A single `{i18n:}` line references that key; otherwise the literal
  // lines are joined and allocated a fresh key.
  /**
   * A lore line, as it may appear on the wire.
   *
   * The canonical form is a string. But older files carry STRUCTURED text — an
   * i18n reference (`{ key: … }`) or a layer (`{ kind: plain, value: … }`, the
   * title shape). `String()` rendered them literally as "[object Object]", in
   * the editor as in game: unreadable lore on a file nothing flags.
   *
   * What still cannot be read ends up as JSON rather than "[object Object]":
   * one can be diagnosed, the other cannot.
   */
  function loreLine(line: unknown): string | Record<string, string> {
    if (typeof line === "string") return line;
    if (isLangMap(line)) return line;
    if (line && typeof line === "object") {
      const o = line as Record<string, unknown>;
      if (typeof o.key === "string") return `{i18n:${o.key}}`;
      if ("value" in o) return loreLine(o.value);
      if (typeof o.text === "string") return o.text;
    }
    if (line === null || line === undefined) return "";
    return JSON.stringify(line);
  }

  function loreText(lore: unknown): LText | undefined {
    if (!Array.isArray(lore) || lore.length === 0) return undefined;
    if (lore.length === 1) return text(loreLine(lore[0]));
    return text(
      lore
        .map(loreLine)
        .filter((l): l is string => typeof l === "string")
        .join("\n"),
    );
  }

  function appearance(a: Json): DomainAppearance {
    const out: DomainAppearance = {};
    const ifa = ifArray(a.if);
    if (ifa) {
      out.if = ifa.conds;
      if (ifa.joins.length > 0) out.ifJoins = ifa.joins;
    }
    if (a.image && typeof a.image.asset === "string")
      out.image = {
        asset: a.image.asset,
        ...(a.image.fit ? { fit: a.image.fit } : {}),
        ...(a.image.offset_x !== undefined ? { offset_x: a.image.offset_x } : {}),
        ...(a.image.offset_y !== undefined ? { offset_y: a.image.offset_y } : {}),
      };
    else if (typeof a.item === "string") out.item = a.item;
    else if (a.material) out.material = a.material;
    if (a.head) out.head = a.head;
    if (a.count !== undefined) out.count = a.count;
    if (a.title !== undefined) out.title = text(a.title);
    const lore = loreText(a.lore);
    if (lore !== undefined) out.lore = lore;
    if (a.lore_mode === "replace") {
      out.loreMode = "replace";
      if (!out.lore) out.lore = text("");
    }
    const click = clickMap(a.click);
    if (click) out.click = click;
    Object.assign(out, readAdvanced(a as Record<string, unknown>));
    return out;
  }

  return { appearance };
}

export function menuV1ToDomain(
  src: Json,
  opts: {
    projectId: ProjectId;
    lang: string;
    translations?: Record<string, Record<string, string>>;
  },
): ImportResult {
  const i18nKeys: Record<string, Record<string, string>> = {};
  const unsupported: string[] = [];

  // i18n bridge
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

  // Shared wire→domain converter (appearance conditions + DSL steps)
  const { appearance } = makeAppearanceConverter({
    text,
    ref,
    pushUnsupported: (s) => unsupported.push(s),
  });

  // Title layers (inverse of serializeTitleLayer)
  /** Layer `value`: canonical string form (`"{i18n:key}"` or literal), a
   *  field-local `{lang: text}` map, or the legacy `{key}` object form. */
  function layerValue(v: unknown): LText {
    if (typeof v === "string") return text(v);
    if (isLangMap(v)) return text(v);
    return ref((v as Json)?.key ?? "");
  }

  function titleLayer(l: Json): MenuTitleLayer | null {
    // A bare string entry is a plain text layer (canonical sugar).
    if (typeof l === "string") return { kind: "plain", value: text(l) };
    // A bare `{lang: text}` map is the field-local form of a plain layer.
    if (isLangMap(l)) return { kind: "plain", value: text(l) };
    // Asset ref: `asset: <name>` first, then the legacy `asset_id` (ADR
    // `assets-on-server-disk`, decision 2); same order as the plugin's MenuTitleParser.
    const asset = (l.asset ?? l.asset_id) as AssetId;
    const font = (l.font ?? l.font_asset_id) as AssetId | undefined;
    switch (l.kind) {
      case "background":
        return { kind: "background", assetId: asset };
      case "glyph":
        return { kind: "glyph", assetId: asset, x: l.x, y: l.y };
      case "text": {
        const out: MenuTitleLayer = {
          kind: "text",
          value: layerValue(l.value),
          x: l.x,
          y: l.y,
        };
        if (l.color !== undefined) out.color = l.color;
        if (font !== undefined) out.fontAssetId = font;
        if (l.size !== undefined && TEXT_SIZES.includes(l.size)) out.size = l.size as TextSize;
        return out;
      }
      case "plain": {
        const out: MenuTitleLayer = { kind: "plain", value: layerValue(l.value) };
        if (l.color !== undefined) out.color = l.color;
        return out;
      }
      case "textarea": {
        const out: MenuTitleLayer = {
          kind: "textarea",
          value: layerValue(l.value),
          x: l.x,
          y: l.y,
          width: l.width,
          lineHeight: l.line_height,
          alignment: l.alignment,
        };
        if (font !== undefined) out.fontAssetId = font;
        if (l.size !== undefined && TEXT_SIZES.includes(l.size)) out.size = l.size as TextSize;
        return out;
      }
      case "external_glyph":
        return {
          kind: "external_glyph",
          provider: l.provider,
          glyphName: l.glyph_name,
          x: l.x,
          y: l.y,
        };
      default:
        unsupported.push(`title layer: ${l.kind}`);
        return null;
    }
  }

  function contextInput(ci: Json): DomainContextInput {
    // Canonical connector shape: { name, type, source: { ref, … } }.
    if (ci.source?.ref !== undefined) {
      return {
        kind: "sourceRef",
        name: ci.name,
        ref: ci.source.ref,
        ...(ci.source.params ? { params: ci.source.params } : {}),
        ...(ci.source.filter ? { filter: ci.source.filter } : {}),
        ...(ci.source.sort ? { sort: ci.source.sort } : {}),
        ...(ci.source.limit !== undefined ? { limit: ci.source.limit } : {}),
      };
    }
    // Legacy flat shape emitted by older exports: { name, ref }.
    if (ci.ref !== undefined) {
      return { kind: "sourceRef", name: ci.name, ref: ci.ref };
    }
    return {
      kind: "primitive",
      ...(ci.row_of !== undefined ? { rowOf: ci.row_of } : {}),
      name: ci.name,
      type: ci.type,
      ...(ci.default !== undefined ? { default: ci.default } : {}),
    };
  }

  /** Wire positions: bare int, range/comma string, or list of both → the
   *  domain's comma-joined string. */
  function positionsSpec(v: unknown): string {
    if (Array.isArray(v)) return v.map(String).join(",");
    return String(v ?? "");
  }

  /** Wire iterates/places → domain. `template` is a LEGACY ref to the removed
   *  project-level Item template: it is carried through UNTYPED so
   *  `projectFromFiles` can inline it, and never survives onto a saved element. */
  function iteratesOf(it: Json): DomainElement["iterates"] {
    return {
      source: it.source,
      alias: it.alias ?? "",
      ...(it.template ? { templateId: it.template } : {}),
    } as DomainElement["iterates"];
  }
  function placesOf(pl: Json): DomainElement["places"] {
    return {
      source: pl.source,
      alias: pl.alias ?? "",
      keyField: pl.key_field ?? pl.keyField ?? "",
      ...(pl.template ? { templateId: pl.template } : {}),
      placements: ((pl.placements as Json[]) ?? []).map((p) => ({
        key: String(p.key),
        page: p.page ?? 0,
        position: p.position ?? 0,
      })),
    } as DomainElement["places"];
  }

  function element(el: Json): DomainElement {
    // Older shape: an `appearances` LIST, display first. The current format wins
    // if present — the list is only a leftover. It is still read because files
    // written before exist in production: no longer recognising them did not
    // flag them, it rendered them empty (invisible items, empty template).
    // Tolerant reader, canonical writer — the next save puts the file right, and
    // `appearances` disappears on its own.
    const flat = appearance(el);
    const legacy =
      Object.keys(flat).length === 0 && Array.isArray(el.appearances)
        ? (el.appearances as Json[]).map(appearance)
        : null;
    return {
      id: el.id,
      positions: positionsSpec(el.positions),
      // The display's fields sit flat on the element; `appearance` is
      // allow-list driven, so the structural keys around them are ignored.
      display: legacy ? (legacy[0] ?? {}) : flat,
      states: legacy ? legacy.slice(1) : ((el.states as Json[]) ?? []).map(appearance),
      ...(el.iterates ? { iterates: iteratesOf(el.iterates) } : {}),
      ...(el.places ? { places: placesOf(el.places) } : {}),
      ...(el.tags ? { tags: el.tags } : {}),
    };
  }

  function layer(l: Json): DomainLayer {
    return {
      id: l.id,
      name: l.name,
      elements: (l.elements as Json[]).map(element),
    };
  }

  const rawType = (src.inventory_type ?? "chest") as string;
  const inventoryType: InventoryType =
    rawType === "hopper" || rawType === "dropper" ? rawType : "chest";
  // Chest: rows = size/9. Hopper/dropper: rows is irrelevant to geometry; store
  // the type's fixed row count (1 / 3) so a later switch-to-chest is sane.
  const rows = (
    inventoryType === "chest" ? src.size / 9 : (INVENTORY_TYPES[inventoryType].rows ?? 1)
  ) as 1 | 2 | 3 | 4 | 5 | 6;
  // Canonical sugar: a bare-string title is one plain text layer. Its i18n
  // twin — an LText ref (`title: { key: … }`) — is the same sugar with the
  // text held in a lang file, and is what a module bootstrap emits. Neither is
  // an array: mapping over them threw and took the whole editor down with a
  // black page.
  const rawTitle = src.title as unknown;
  const titleEntries: (MenuTitleLayer | null)[] =
    typeof rawTitle === "string"
      ? [titleLayer(rawTitle as unknown as Json)]
      : Array.isArray(rawTitle)
        ? (rawTitle as Json[]).map(titleLayer)
        : rawTitle && typeof rawTitle === "object"
          ? (rawTitle as Json).kind !== undefined
            ? [titleLayer(rawTitle as Json)]
            : [{ kind: "plain", value: layerValue(rawTitle) } as MenuTitleLayer]
          : [];
  const title = titleEntries.filter(Boolean) as MenuTitleLayer[];
  // Canonical `inputs`; legacy `context_inputs` still read.
  const contextInputs = ((src.inputs ?? src.context_inputs) as Json[] | undefined)?.map(
    contextInput,
  );
  const menu: DomainMenu = {
    id: src.id as MenuId,
    projectId: opts.projectId,
    title,
    rows,
    ...(inventoryType !== "chest" ? { inventoryType } : {}),
    ...(src.player_inventory === "hidden" ? { playerInventory: "hidden" as const } : {}),
    ...(src.vanilla_texture === false ? { vanillaTexture: false as const } : {}),
    // Canonical form: flat top-level `elements` (order = stacking) → one
    // default layer. Legacy `layers` wrapping is still read as-is.
    layers: Array.isArray(src.layers)
      ? (src.layers as Json[]).map(layer)
      : [
          {
            id: "l1" as DomainLayer["id"],
            name: "default",
            elements: ((src.elements as Json[]) ?? []).map(element),
          },
        ],
    ...(src.permission ? { permission: src.permission } : {}),
    ...(typeof src.notes === "string" && src.notes ? { notes: src.notes } : {}),
    ...(contextInputs && contextInputs.length > 0 ? { contextInputs } : {}),
  };

  return { menu, i18nKeys, unsupported };
}
