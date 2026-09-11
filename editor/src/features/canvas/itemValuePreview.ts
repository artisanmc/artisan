import { capturedPresentation } from "@/domain/capturedItems";
import { capturedStackDetails } from "@/domain/capturedStack";
import { readAdvanced } from "@/domain/itemAdvanced";
import type { Appearance, Project } from "@/domain/types";
import { evaluate } from "@/lib/expr/evaluator";
import { parse } from "@/lib/expr/parser";
import { Scope } from "@/lib/expr/scope";
import { getText } from "@/lib/i18n";
import { renderPreview } from "./menuPreviewScope";

/** Resolve a whole item value before applying the menu's presentation layer. */
export function previewItem(
  app: Appearance,
  ctx: Record<string, unknown>,
  project: Project,
  lang: string,
) {
  const raw = (app.item ?? app.material)?.trim();
  let value: unknown;
  if (raw?.startsWith("{") && raw.endsWith("}")) {
    try {
      value = evaluate(parse(raw.slice(1, -1)), new Scope(ctx));
    } catch {
      /* Incomplete expression. */
    }
  }
  const icon =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).material === "string"
      ? (value as Record<string, unknown>)
      : undefined;
  const material = icon
    ? renderPreview(icon.material as string, ctx, project, lang)
    : raw
      ? renderPreview(raw, ctx, project, lang)
      : undefined;
  const captured = material?.startsWith("item:")
    ? project.capturedItems?.find((c) => String(c.id) === material.slice(5))
    : undefined;
  const stack = captured ? capturedStackDetails(captured.stackYaml) : undefined;
  const base = icon ? readAdvanced(icon) : {};
  const enchants = [
    ...new Map(
      [...(stack?.enchants ?? []), ...(base.enchants ?? []), ...(app.enchants ?? [])].map((e) => [
        e.id,
        e,
      ]),
    ).values(),
  ];
  const presentation = capturedPresentation(project, material);
  const titleRaw = getText(project, app.title, lang);
  const iconTitle = typeof icon?.title === "string" ? icon.title : presentation.name;
  const ownLore = app.lore ? getText(project, app.lore, lang) : "";
  const iconLore = Array.isArray(icon?.lore)
    ? icon.lore.filter((v): v is string => typeof v === "string")
    : [];
  return {
    material,
    head:
      app.head ??
      (typeof icon?.head === "string" ? renderPreview(icon.head, ctx, project, lang) : undefined),
    count:
      app.count ??
      (typeof icon?.count === "number"
        ? Math.max(1, Math.min(64, Math.floor(icon.count)))
        : (captured?.display.count ?? stack?.count)),
    enchanted: Boolean(
      app.enchanted ||
        base.enchanted ||
        captured?.display.enchanted ||
        stack?.enchanted ||
        enchants.length,
    ),
    enchants,
    title: titleRaw
      ? renderPreview(titleRaw, ctx, project, lang)
      : iconTitle
        ? renderPreview(iconTitle, ctx, project, lang)
        : undefined,
    lore: [...presentation.lore, ...iconLore, ...(ownLore ? ownLore.split("\n") : [])].flatMap(
      (line) => renderPreview(line, ctx, project, lang).split("\n"),
    ),
  };
}
