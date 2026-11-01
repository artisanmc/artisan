import { classifyDocumentLayout } from "@/domain/documentLayout";

const MENU_DIRS: ReadonlySet<string> = new Set(["menus"]);

/**
 * The menu files of a module, as the plugin reads them (`DocumentLayout.menuPaths`
 * in `plugin/pack`): themed folders and, with `variants.yml`, the variants' menus.
 */
export function menuPaths(files: { path: string }[]): Set<string> {
  const layout = classifyDocumentLayout(
    files.map((f) => f.path),
    MENU_DIRS,
  );
  return new Set([...layout.documents, ...layout.variants].map((d) => d.path));
}
