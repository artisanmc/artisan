import type { Appearance, Project } from "@/domain/types";
import { resolveItem } from "./resolveItem";

export function previewItem(
  app: Appearance,
  ctx: Record<string, unknown>,
  project: Project,
  lang: string,
) {
  const item = resolveItem(app, ctx, project, lang);
  return { ...item, enchants: item.enchants ?? [] };
}
