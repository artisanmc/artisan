import { capturedPresentation } from "@/domain/capturedItems";
import { capturedStackDetails } from "@/domain/capturedStack";
import { type AdvancedFields, readAdvanced } from "@/domain/itemAdvanced";
import type { LText, Project } from "@/domain/types";
import { evaluate } from "@/lib/expr/evaluator";
import { parse } from "@/lib/expr/parser";
import { Scope } from "@/lib/expr/scope";
import { getText } from "@/lib/i18n";
import { wrapLore } from "@/lib/loreWrap";
import { renderLore } from "@/lib/mm/loreLines";
import { renderPreview } from "./menuPreviewScope";

/** Placeholder rendering the base item's lore where it is written. */
export const BASE_LORE = "{base.lore}";

export interface ResolvedItem extends AdvancedFields {
  material?: string;
  head?: string;
  title?: string;
  lore: string[];
  count?: number;
  error?: string;
}

/** Each layer renders once, with a snapshot of its immediate base. */
export function resolveItem(
  value: unknown,
  scope: Record<string, unknown>,
  project: Project,
  lang: string,
): ResolvedItem {
  const visiting = new Set<unknown>();
  const rawText = (v: unknown): string =>
    typeof v === "string"
      ? v
      : v && typeof v === "object" && "key" in v
        ? getText(project, v as LText, lang)
        : "";
  const text = (v: unknown, ctx: Record<string, unknown>): string => {
    const raw =
      typeof v === "string"
        ? v
        : v && typeof v === "object" && "key" in v
          ? getText(project, v as LText, lang)
          : "";
    return renderPreview(raw, ctx, project, lang);
  };
  function resolve(v: unknown, ctx: Record<string, unknown>, depth = 0): ResolvedItem {
    if (depth > 32 || visiting.has(v)) throw new Error("Circular item inheritance");
    if (v == null || v === "") return { lore: [] };
    visiting.add(v);
    try {
      if (typeof v === "string") {
        const raw = v.trim();
        if (raw.startsWith("{") && raw.endsWith("}")) {
          const next = evaluate(parse(raw.slice(1, -1)), new Scope(ctx));
          if (next == null) throw new Error(`Unresolved item: ${raw}`);
          return resolve(next, ctx, depth + 1);
        }
        const material = text(v, ctx);
        const captured = material.startsWith("item:")
          ? project.capturedItems?.find((c) => String(c.id) === material.slice(5))
          : undefined;
        const stack = captured ? capturedStackDetails(captured.stackYaml) : undefined;
        const presentation = capturedPresentation(project, material);
        return {
          ...stack,
          material,
          title: presentation.name,
          lore: presentation.lore,
          count: captured?.display.count ?? stack?.count,
          enchanted: captured?.display.enchanted ?? stack?.enchanted,
        };
      }
      if (typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid item value");
      const own = v as Record<string, unknown>;
      const base = resolve(own.extends ?? own.item ?? own.material, ctx, depth + 1);
      const local = { ...ctx, base: { ...base, lore: base.lore.join("\n") } };
      const advanced = readAdvanced({
        ...own,
        custom_model_data: own.customModelData ?? own.custom_model_data,
      });
      if (Array.isArray(own.enchants))
        advanced.enchants = own.enchants as NonNullable<AdvancedFields["enchants"]>;
      const enchants = [
        ...new Map(
          [...(base.enchants ?? []), ...(advanced.enchants ?? [])].map((e) => [e.id, e]),
        ).values(),
      ];
      const result: ResolvedItem = { ...base, ...advanced, enchants };
      if (own.enchanted === undefined) result.enchanted = base.enchanted || enchants.length > 0;
      if (own.count !== undefined)
        result.count = Math.max(1, Math.min(64, Math.floor(Number(own.count)) || 1));
      if (own.title != null) result.title = text(own.title, local);
      if (own.head != null) result.head = text(own.head, local);
      if (own.lore != null) {
        const lines = Array.isArray(own.lore) ? own.lore : [own.lore];
        const binding = own.item ?? own.material;
        const alias =
          typeof binding === "string" ? /^\{(\w+)\.icon\}$/.exec(binding)?.[1] : undefined;
        const row = alias ? (ctx[alias] as Record<string, unknown> | undefined) : undefined;
        const icon = row?.icon as Record<string, unknown> | undefined;
        const legacyToken =
          alias &&
          icon?.extends !== undefined &&
          icon.lore !== undefined &&
          (row?.lore == null ||
            row.lore === "" ||
            (Array.isArray(row.lore) && row.lore.length === 0))
            ? `{${alias}.lore}`
            : undefined;
        const legacy = legacyToken && lines.some((line) => rawText(line).includes(legacyToken));
        const tokened = lines.map((line) =>
          legacy ? rawText(line).replaceAll(legacyToken!, BASE_LORE) : line,
        );
        const rendered = tokened
          .flatMap((line) =>
            renderLore(rawText(line), (src) => renderPreview(src, local, project, lang)),
          )
          .flatMap((line) => wrapLore(line, project.loreMaxWidth ?? 0));
        // The base lore stays by default; it only goes on explicit request
        // (`lore_mode: replace`) or when `{base.lore}` places it itself —
        // otherwise it would appear twice.
        const replacement =
          tokened.some((line) => rawText(line).includes(BASE_LORE)) ||
          own.lore_mode === "replace" ||
          own.loreMode === "replace";
        const cleared = rendered.length === 1 && rendered[0] === "";
        result.lore = replacement
          ? cleared
            ? []
            : rendered
          : cleared
            ? base.lore
            : [...base.lore, ...rendered];
      }
      return result;
    } finally {
      visiting.delete(v);
    }
  }
  try {
    return resolve(value, scope);
  } catch (error) {
    return {
      material: "BARRIER",
      lore: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
