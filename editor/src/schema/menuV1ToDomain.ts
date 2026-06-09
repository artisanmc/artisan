import type {
  AssetId,
  ClickHandler,
  ClickMap,
  ClickType,
  DialogId,
  Action as DomainAction,
  Appearance as DomainAppearance,
  Condition as DomainCondition,
  ContextInput as DomainContextInput,
  Element as DomainElement,
  Layer as DomainLayer,
  Menu as DomainMenu,
  Step as DomainStep,
  ElementId,
  I18nKey,
  LText,
  MenuId,
  MenuTitleLayer,
  PackId,
  TextSize,
} from "@/domain/types";
import { newI18nKey } from "@/lib/i18n";

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

const DOMAIN_CONDITIONS = new Set([
  "has_permission",
  "has_money",
  "placeholder_equals",
  "placeholder_match",
  "not",
  "and",
  "or",
  "expression",
]);

export function menuV1ToDomain(
  src: Json,
  opts: { packId: PackId; lang: string; translations?: Record<string, Record<string, string>> },
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

  // ── conditions (explicit per-type mapping; NOT pass-through) ──────────────
  function condition(c: Json): DomainCondition | null {
    if (!c || typeof c !== "object" || !DOMAIN_CONDITIONS.has(c.type)) {
      unsupported.push(`condition: ${c?.type}`);
      return null;
    }
    switch (c.type) {
      case "has_permission":
        return { type: "has_permission", perm: c.perm };
      case "has_money":
        return { type: "has_money", amount: c.amount };
      case "placeholder_equals":
        return { type: "placeholder_equals", placeholder: c.placeholder, value: c.value };
      case "placeholder_match":
        return { type: "placeholder_match", placeholder: c.placeholder, regex: c.regex };
      case "expression":
        return { type: "expression", expr: c.expr };
      case "not": {
        const of = condition(c.of);
        return of ? { type: "not", of } : null;
      }
      case "and":
        return {
          type: "and",
          of: (c.of as Json[]).map(condition).filter(Boolean) as DomainCondition[],
        };
      case "or":
        return {
          type: "or",
          of: (c.of as Json[]).map(condition).filter(Boolean) as DomainCondition[],
        };
      default:
        unsupported.push(`condition: ${c.type}`);
        return null;
    }
  }

  // `if` array (ANDed) → domain if[] + ifJoins all "and".
  function ifArray(
    arr: Json[] | undefined,
  ): { conds: DomainCondition[]; joins: ("and" | "or")[] } | undefined {
    if (!arr || arr.length === 0) return undefined;
    const conds = arr.map(condition).filter(Boolean) as DomainCondition[];
    if (conds.length === 0) return undefined;
    return { conds, joins: new Array(Math.max(0, conds.length - 1)).fill("and") };
  }

  // ── actions (un-snake, pagination_* → paginate, vocab subset) ─────────────
  function action(a: Json): DomainAction | null {
    switch (a.type) {
      case "open_menu":
        return {
          type: "open_menu",
          menuId: a.menu_id as MenuId,
          ...(a.clear_context ? { clearContext: true } : {}),
          ...(a.context ? { context: a.context } : {}),
        };
      case "close_menu":
        return { type: "close_menu" };
      case "run_command":
        return { type: "run_command", command: a.command, as: a.as ?? "player" };
      case "send_message":
        return { type: "send_message", text: text(a.text) };
      case "show_title":
        return {
          type: "show_title",
          title: text(a.title),
          ...(a.subtitle !== undefined ? { subtitle: text(a.subtitle) } : {}),
          ...(a.fade_in !== undefined ? { fadeIn: a.fade_in } : {}),
          ...(a.stay !== undefined ? { stay: a.stay } : {}),
          ...(a.fade_out !== undefined ? { fadeOut: a.fade_out } : {}),
        };
      case "give_item":
        return { type: "give_item", material: a.material, count: a.count };
      case "take_money":
        return { type: "take_money", amount: a.amount };
      case "pagination_next":
        return {
          type: "paginate",
          direction: "next",
          ...(a.element_id ? { targetElementId: a.element_id as ElementId } : {}),
        };
      case "pagination_prev":
        return {
          type: "paginate",
          direction: "prev",
          ...(a.element_id ? { targetElementId: a.element_id as ElementId } : {}),
        };
      case "set_arg":
        return { type: "set_arg", arg: a.arg, value: a.value };
      case "set_arg_cycle_next":
        return { type: "set_arg_cycle_next", arg: a.arg, list: a.list };
      case "set_arg_cycle_prev":
        return { type: "set_arg_cycle_prev", arg: a.arg, list: a.list };
      case "open_dialog":
        return {
          type: "open_dialog",
          dialogId: a.dialog_id as DialogId,
          ...(a.clear_context ? { clearContext: true } : {}),
          ...(a.context ? { context: a.context } : {}),
        };
      case "close_dialog":
        return { type: "close_dialog" };
      default:
        unsupported.push(`action: ${a.type}`);
        return null;
    }
  }

  function step(s: Json): DomainStep | null {
    if (s.kind === "action") {
      const act = action(s.action);
      return act ? { kind: "action", action: act } : null;
    }
    if (s.kind === "if") {
      return {
        kind: "if",
        cases: (s.cases as Json[]).map((c) => ({
          conditions: (c.conditions as Json[]).map(condition).filter(Boolean) as DomainCondition[],
          ...(c.joins ? { joins: c.joins } : {}),
          steps: (c.steps as Json[]).map(step).filter(Boolean) as DomainStep[],
        })),
        ...(s.else ? { else: (s.else as Json[]).map(step).filter(Boolean) as DomainStep[] } : {}),
      };
    }
    unsupported.push(`step kind: ${s.kind}`);
    return null;
  }

  function clickMap(click: Json | undefined): ClickMap | undefined {
    if (!click || typeof click !== "object") return undefined;
    const out: ClickMap = {};
    for (const ct of CLICK_TYPES) {
      const handler = click[ct] as Json | undefined;
      if (!handler) continue;
      const steps = (handler.steps as Json[]).map(step).filter(Boolean) as DomainStep[];
      out[ct] = { steps } satisfies ClickHandler;
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
    if (ci.ref !== undefined) {
      return { kind: "sourceRef", name: ci.name, ref: ci.ref };
    }
    return {
      kind: "primitive",
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

  const rows = (src.size / 9) as 1 | 2 | 3 | 4 | 5 | 6;
  const title = ((src.title as Json[]) ?? []).map(titleLayer).filter(Boolean) as MenuTitleLayer[];
  const contextInputs = (src.context_inputs as Json[] | undefined)?.map(contextInput);
  const menu: DomainMenu = {
    id: src.id as MenuId,
    packId: opts.packId,
    title,
    rows,
    layers: (src.layers as Json[]).map(layer),
    ...(src.permission ? { permission: src.permission } : {}),
    ...(contextInputs && contextInputs.length > 0 ? { contextInputs } : {}),
  };

  return { menu, i18nKeys, unsupported };
}
