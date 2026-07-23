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
  /** i18n keys allocated for literal text (to merge into pack.i18nKeys by the caller). */
  i18nKeys: Record<string, Record<string, string>>;
  /** menu/v1 constructs without a domain equivalent (the domain is a subset of the plugin vocab). */
  unsupported: string[];
}

export function menuV1ToDomain(
  src: Json,
  opts: { projectId: ProjectId; lang: string; translations?: Record<string, Record<string, string>> },
): ImportResult {
  const i18nKeys: Record<string, Record<string, string>> = {};
  const unsupported: string[] = [];

  // ── i18n bridge ──────────────────────────────────────────────────────────
  function ref(key: string): LText {
    const tr = opts.translations?.[key];
    if (tr) i18nKeys[key] = { ...tr };
    return { key: key as I18nKey };
  }
  function text(raw: string | undefined): LText {
    const m = typeof raw === "string" ? /^\{i18n:(.+)\}$/.exec(raw) : null;
    if (m) return ref(m[1]!);
    const key = newI18nKey();
    i18nKeys[key] = { [opts.lang]: raw ?? "" };
    return { key };
  }

  // ── shared wire→domain converter (appearance conditions + DSL steps) ──────
  const { steps: parseSteps, ifArray } = makeStepConverter({
    text,
    ref,
    pushUnsupported: (s) => unsupported.push(s),
  });

  function clickMap(click: Json | undefined): ClickMap | undefined {
    if (!click || typeof click !== "object") return undefined;
    const out: ClickMap = {};
    for (const ct of CLICK_TYPES) {
      const handler = click[ct] as Json | string | undefined;
      if (!handler) continue;
      // Canonical collapsed form: the handler IS the Action DSL string.
      // Legacy object form `{steps: "<dsl>"}` is still accepted.
      const dsl = typeof handler === "string" ? handler : handler.steps;
      out[ct] = { steps: parseSteps(dsl) } satisfies ClickHandler;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  // ── appearance / element / layer / menu ───────────────────────────────────
  function appearance(a: Json): DomainAppearance {
    const out: DomainAppearance = {};
    const ifa = ifArray(a.if);
    if (ifa) {
      out.if = ifa.conds;
      if (ifa.joins.length > 0) out.ifJoins = ifa.joins;
    }
    if (a.material) out.material = a.material;
    if (a.head) out.head = a.head;
    if (a.count !== undefined) out.count = a.count;
    if (a.title !== undefined) out.title = text(a.title);
    const lore = loreText(a.lore);
    if (lore !== undefined) out.lore = lore;
    const click = clickMap(a.click);
    if (click) out.click = click;
    return out;
  }

  // menu/v1 lore is `string[]`; domain lore is a single LText (lines joined by
  // `\n`). A single `{i18n:}` line references that key; otherwise the literal
  // lines are joined and allocated a fresh key.
  function loreText(lore: unknown): LText | undefined {
    if (!Array.isArray(lore) || lore.length === 0) return undefined;
    if (lore.length === 1) return text(String(lore[0]));
    return text(lore.map(String).join("\n"));
  }

  // ── title layers (inverse of serializeTitleLayer) ─────────────────────────
  function titleLayer(l: Json): MenuTitleLayer | null {
    switch (l.kind) {
      case "background":
        return { kind: "background", assetId: l.asset_id as AssetId };
      case "glyph":
        return { kind: "glyph", assetId: l.asset_id as AssetId, x: l.x, y: l.y };
      case "text": {
        const out: MenuTitleLayer = {
          kind: "text",
          value: ref(l.value.key),
          x: l.x,
          y: l.y,
        };
        if (l.color !== undefined) out.color = l.color;
        if (l.font_asset_id !== undefined) out.fontAssetId = l.font_asset_id as AssetId;
        if (l.size !== undefined && TEXT_SIZES.includes(l.size)) out.size = l.size as TextSize;
        return out;
      }
      case "plain": {
        const out: MenuTitleLayer = { kind: "plain", value: ref(l.value.key) };
        if (l.color !== undefined) out.color = l.color;
        return out;
      }
      case "textarea": {
        const out: MenuTitleLayer = {
          kind: "textarea",
          value: ref(l.value.key),
          x: l.x,
          y: l.y,
          width: l.width,
          lineHeight: l.line_height,
          alignment: l.alignment,
        };
        if (l.font_asset_id !== undefined) out.fontAssetId = l.font_asset_id as AssetId;
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

  function element(el: Json): DomainElement {
    return {
      id: el.id,
      positions: el.positions,
      appearances: (el.appearances as Json[]).map(appearance),
      ...(el.iterates ? { iterates: el.iterates } : {}),
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
  const title = ((src.title as Json[]) ?? []).map(titleLayer).filter(Boolean) as MenuTitleLayer[];
  const contextInputs = (src.context_inputs as Json[] | undefined)?.map(contextInput);
  const menu: DomainMenu = {
    id: src.id as MenuId,
    projectId: opts.projectId,
    title,
    rows,
    ...(inventoryType !== "chest" ? { inventoryType } : {}),
    layers: (src.layers as Json[]).map(layer),
    ...(src.permission ? { permission: src.permission } : {}),
    ...(typeof src.notes === "string" && src.notes ? { notes: src.notes } : {}),
    ...(contextInputs && contextInputs.length > 0 ? { contextInputs } : {}),
  };

  return { menu, i18nKeys, unsupported };
}
