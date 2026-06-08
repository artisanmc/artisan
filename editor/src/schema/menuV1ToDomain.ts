import { newI18nKey } from "@/lib/i18n";
import type {
  Appearance as DomainAppearance,
  Condition as DomainCondition,
  Element as DomainElement,
  I18nKey,
  Layer as DomainLayer,
  LText,
  Menu as DomainMenu,
  MenuId,
  PackId,
} from "@/domain/types";

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

  // ── appearance / element / layer / menu (Task 1: material + title + if) ───
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
    return out;
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
  const menu: DomainMenu = {
    id: src.id as MenuId,
    packId: opts.packId,
    title: [],
    rows,
    layers: (src.layers as Json[]).map(layer),
    ...(src.permission ? { permission: src.permission } : {}),
  };

  return { menu, i18nKeys, unsupported };
}
