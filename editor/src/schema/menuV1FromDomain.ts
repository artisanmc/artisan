// Domain → `menu/v1` writer: the inverse of `menuV1ToDomain.ts`.
import { menusOf } from "@/domain/documents";
import { writeAdvanced } from "@/domain/itemAdvanced";
import type { Appearance, Element, Menu, MenuTitleLayer, Project } from "@/domain/types";
import { slotCount } from "@/features/canvas/inventoryTypes";
import { conditionsToStructured, stepsToStructured } from "@/lib/actions/structuredSteps";
import { type FieldTextOf, actionTextCodec, fieldTextOf, loreWire } from "./fieldText";

/** A Document as its writer returns it: the canonical file object, `id` included. */
export type DocumentV1 = { id: string } & Record<string, unknown>;

function serializeAppearance(app: Appearance, project: Project): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (app.if && app.if.length > 0) out.if = conditionsToStructured(app.if, app.ifJoins);
  if (app.image) out.image = app.image;
  else if (app.item !== undefined) out.item = app.item;
  else if (app.material) out.material = app.material;
  if (app.head) out.head = app.head;
  if (app.count !== undefined) out.count = app.count;
  const t = fieldTextOf(project);
  if (app.title) out.title = t(app.title.key);
  if (app.lore) out.lore = loreWire(t(app.lore.key));
  if (app.loreMode) {
    out.lore_mode = app.loreMode;
    if (!app.lore) out.lore = [];
  }
  if (app.click) {
    const clickOut: Record<string, unknown> = {};
    const codec = actionTextCodec(project);
    for (const [clickType, handler] of Object.entries(app.click)) {
      if (!handler) continue;
      // Canonical wire: a list of structured steps (ADR `structured-action-wire`);
      // action text is field-local.
      clickOut[clickType] = stepsToStructured(handler.steps, codec);
    }
    if (Object.keys(clickOut).length > 0) out.click = clickOut;
  }
  writeAdvanced(app, out);
  return out;
}

/**
 * Serialize an element. A set is self-contained: how its rows look and behave
 * lives on the element that renders them, in the menu it belongs to — there is
 * no project-level template to resolve.
 */
function serializeElement(el: Element, project: Project): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: el.id,
    // A single numeric position emits as a bare int (no YAML quoting trap);
    // ranges/comma lists stay strings. No position (an element laid out by
    // `places` alone) is an empty list: the schema rejects an empty string.
    positions:
      el.positions === "" ? [] : /^\d+$/.test(el.positions) ? Number(el.positions) : el.positions,
    // The display is written FLAT on the element (ADR
    // `element-display-and-states`); `serializeAppearance` only ever emits
    // appearance keys, which `elementStructuralKeys` keeps disjoint from ours.
    ...serializeAppearance(el.display, project),
  };
  if (el.iterates) {
    out.iterates = { source: el.iterates.source, alias: el.iterates.alias };
  }
  if (el.places) {
    // `key_field` is snake_case on the wire (plugin PlacesYaml); cachedDisplay is
    // editor-only (offline render fallback) and never written to the files.
    out.places = {
      source: el.places.source,
      alias: el.places.alias,
      key_field: el.places.keyField,
      placements: el.places.placements.map((p) => ({
        key: p.key,
        page: p.page,
        position: p.position,
      })),
    };
  }
  if (el.states.length > 0) {
    out.states = el.states.map((s) => serializeAppearance(s, project));
  }
  if (el.tags && el.tags.length > 0) out.tags = el.tags;
  return out;
}

/** Canonical wire is a flat `elements` list (document order = stacking order,
 *  later wins per slot) — editor layers flatten at export; the legacy `layers`
 *  wrapping is import-only. */
function serializeElements(menu: Menu, project: Project): Record<string, unknown>[] {
  return menu.layers.flatMap((l) => l.elements).map((el) => serializeElement(el, project));
}

function serializeTitleLayer(
  layer: MenuTitleLayer,
  t: FieldTextOf,
): Record<string, unknown> | string {
  if (layer.kind === "background") {
    return { kind: "background", asset_id: layer.assetId };
  }
  if (layer.kind === "glyph") {
    return { kind: "glyph", asset_id: layer.assetId, x: layer.x, y: layer.y };
  }
  if (layer.kind === "text") {
    const out: Record<string, unknown> = {
      kind: "text",
      // LText values serialize to the single string form (`{i18n:key}`),
      // matching appearances/actions — the `{key}` object form is import-only.
      value: t(layer.value.key),
      x: layer.x,
      y: layer.y,
    };
    if (layer.color !== undefined) out.color = layer.color;
    if (layer.fontAssetId !== undefined) out.font_asset_id = layer.fontAssetId;
    if (layer.size !== undefined && layer.size !== 8) out.size = layer.size;
    return out;
  }
  if (layer.kind === "plain") {
    const value = t(layer.value.key);
    // Canonical sugar: an uncolored plain layer whose value is a bare string is
    // just that string. A multi-language map must keep the `kind` wrapper — a
    // bare `{lang: text}` entry is not a MenuTitleLayer.
    if (layer.color === undefined && typeof value === "string") return value;
    return layer.color === undefined
      ? { kind: "plain", value }
      : { kind: "plain", value, color: layer.color };
  }
  if (layer.kind === "textarea") {
    const out: Record<string, unknown> = {
      kind: "textarea",
      value: t(layer.value.key),
      x: layer.x,
      y: layer.y,
      width: layer.width,
      line_height: layer.lineHeight,
      alignment: layer.alignment,
    };
    if (layer.fontAssetId !== undefined) out.font_asset_id = layer.fontAssetId;
    if (layer.size !== undefined && layer.size !== 8) out.size = layer.size;
    return out;
  }
  if (layer.kind === "external_glyph") {
    return {
      kind: "external_glyph",
      provider: layer.provider,
      glyph_name: layer.glyphName,
      x: layer.x,
      y: layer.y,
    };
  }
  // Exhaustive guard — TS narrows `layer` to `never` here; runtime fallback
  // returns the layer untouched if a future kind isn't yet handled.
  return layer;
}

/**
 * Serialize a single Menu into a canonical `menu/v1` object (snake_case,
 * `{i18n:key}` refs, title-as-layer-array). This is the public seed used by
 * the AI assistant (`projectToMenuV1`) *and* the file writer
 * (`projectToFiles()`), so the wire shape stays single-sourced.
 */
export function menuV1FromDomain(menu: Menu, project: Project): DocumentV1 {
  const type = menu.inventoryType ?? "chest";
  const t = fieldTextOf(project);
  const titleLayers = menu.title.map((l) => serializeTitleLayer(l, t));
  const [onlyLayer] = menu.title;
  const out: DocumentV1 = {
    schema: "menu/v1",
    id: menu.id,
    // Canonical sugar: a title that is exactly one uncolored plain layer whose
    // value is a bare string serializes to that string; a multi-language map
    // stays in the array layer form (the top-level title union is string|array).
    title:
      menu.title.length === 1 &&
      onlyLayer?.kind === "plain" &&
      onlyLayer.color === undefined &&
      typeof titleLayers[0] === "string"
        ? titleLayers[0]
        : titleLayers,
    size: slotCount(type, menu.rows),
    elements: serializeElements(menu, project),
  };
  if (type !== "chest") out.inventory_type = type;
  if (menu.playerInventory === "hidden") out.player_inventory = "hidden";
  if (menu.vanillaTexture === false) out.vanilla_texture = false;
  if (menu.permission) out.permission = menu.permission;
  if (menu.notes) out.notes = menu.notes;
  if (menu.contextInputs && menu.contextInputs.length > 0) {
    // Canonical field name: `inputs` (`context_inputs` is the legacy spelling).
    out.inputs = menu.contextInputs.map((ci) => {
      if (ci.kind === "primitive") {
        const c: Record<string, unknown> = { name: ci.name, type: ci.type };
        if (ci.rowOf !== undefined) c.row_of = ci.rowOf;
        if (ci.default !== undefined) c.default = ci.default;
        return c;
      }
      // Canonical connector shape — `source` is a ConnectorBinding; `type`
      // is required by the schema (connector-fed inputs are lists in v1).
      const source: Record<string, unknown> = { ref: ci.ref };
      if (ci.params) source.params = ci.params;
      if (ci.filter) source.filter = ci.filter;
      if (ci.sort) source.sort = ci.sort;
      if (ci.limit !== undefined) source.limit = ci.limit;
      return { name: ci.name, type: "list", source };
    });
  }
  return out;
}

/** Serialize every menu in a project to canonical `menu/v1` objects (one per menu). */
export function projectToMenuV1(project: Project): DocumentV1[] {
  return menusOf(project).map((m) => menuV1FromDomain(m, project));
}
