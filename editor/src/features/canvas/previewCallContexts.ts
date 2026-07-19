import { walkActions } from "@/domain/stepPath";
import type { Menu, Project } from "@/domain/types";
import { lookupPath } from "@/lib/placeholders";
import {
  type SourceSnapshots,
  buildPreviewScope,
  renderPreview,
} from "./menuPreviewScope";

/** One way of arriving at a parameterized menu: a caller's open_menu action,
 *  interpolated against one of the caller's iteration rows. */
export interface PreviewCallContext {
  /** Menu the open_menu action lives in. */
  from: string;
  /** Human label for the selector (prefers a `*name*` arg, falls back to the first value). */
  label: string;
  /** Fully resolved context args — whole-token values carry the RAW value
   *  (the caller row object, a number…), mirroring the runtime; apply them
   *  all at once for a coherent preview. */
  args: Record<string, unknown>;
}

const WHOLE_TOKEN_RE = /^\{([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*)\}$/;

function labelOf(v: unknown): string {
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return String(o.name ?? o.id ?? "");
  }
  return v === undefined || v === null ? "" : String(v);
}

function pickLabel(args: Record<string, unknown>, from: string): string {
  const nameKey = Object.keys(args).find((k) => k.toLowerCase().includes("name"));
  const v = labelOf(nameKey ? args[nameKey] : undefined) || labelOf(Object.values(args)[0]);
  return v.trim() ? v : from;
}

/**
 * Enumerate the concrete contexts a menu can be opened WITH, by walking the
 * pack's other menus for `open_menu` actions targeting it: each caller row
 * (iteration/placement alias binding — template alias wins, mirroring the
 * export inlining) yields one candidate with EVERY context arg interpolated
 * together. This is what makes the preview selector coherent: picking
 * "Armes" fills category_id AND category_name from the same source row —
 * the menu itself only ever declares how args are USED (filters), never
 * where their values come from; only call sites know that.
 */
export function findPreviewCallContexts(
  target: Menu,
  pack: Project,
  snapshots: SourceSnapshots | undefined,
  activeLang: string,
): PreviewCallContext[] {
  const out: PreviewCallContext[] = [];
  const seen = new Set<string>();
  for (const caller of pack.menus) {
    if (caller.id === target.id) continue;
    const scope = buildPreviewScope(caller, pack, snapshots);
    for (const layer of caller.layers) {
      for (const el of layer.elements) {
        const tplId = el.places?.templateId ?? el.iterates?.templateId;
        const tpl = tplId ? (pack.itemTemplates ?? []).find((t) => t.id === tplId) : undefined;
        const appearances = tpl ? tpl.appearances : el.appearances;
        const alias = tpl?.alias ?? el.iterates?.alias ?? el.places?.alias;
        const source = el.iterates?.source ?? el.places?.source;
        const rows = source ? lookupPath(scope, source) : undefined;
        for (const app of appearances) {
          for (const handler of Object.values(app.click ?? {})) {
            if (!handler) continue;
            for (const action of walkActions(handler.steps)) {
              if (action.type !== "open_menu" || action.menuId !== target.id) continue;
              const ctxMap = action.context ?? {};
              if (Object.keys(ctxMap).length === 0) continue;
              const rowList = Array.isArray(rows) && alias ? rows : [undefined];
              for (const row of rowList) {
                const rowScope =
                  row !== undefined && alias ? { ...scope, [alias]: row } : scope;
                const args: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(ctxMap)) {
                  const template = String(v);
                  // Whole-token values pass the RAW value (runtime parity:
                  // `cat: {cat}` hands the target the full row object).
                  const whole = WHOLE_TOKEN_RE.exec(template.trim());
                  const raw = whole ? lookupPath(rowScope, whole[1]!) : undefined;
                  args[k] =
                    raw !== undefined && raw !== null
                      ? raw
                      : renderPreview(template, rowScope, pack, activeLang);
                }
                const key = JSON.stringify(args);
                if (seen.has(key)) continue;
                seen.add(key);
                out.push({ from: caller.id, label: pickLabel(args, caller.id), args });
              }
            }
          }
        }
      }
    }
  }
  return out;
}
