import { parse } from "yaml";
import { expandMenuComponents, findComponent } from "../../../../docs/schema/menu/v1/components";

/** The folder the common components are in: the theme `artisan` (`kit.ts`). */
const COMMON = "artisan";
const FILE = /^(originals\/)?components\/([^/]+)\.ya?ml$/;

/**
 * The components of a server's modules (`components/<name>.yml`), read once: `expand(folder)`
 * gives what turns a menu of that module into the menu as it is drawn (`expandMenuComponents`).
 * The common ones are the theme `artisan`'s, the server's own before the one Artisan ships
 * (`originals/components/`). An unreadable file is no component.
 */
export function packComponents(
  projects: readonly { folder: string; files: readonly { path: string; content: string }[] }[],
): (folder: string) => (menu: unknown) => unknown {
  const byFolder = componentFiles(projects);
  if (!byFolder.size) return () => (menu) => menu;
  return (folder) => (menu) =>
    expandMenuComponents(menu, (name) =>
      findComponent(
        folder,
        name,
        (module, bare) => byFolder.get(module === "" ? COMMON : module)?.get(bare),
        COMMON,
      ),
    );
}

/** Each folder's components by name, as read: the common ones under the folder `artisan`. */
export function componentFiles(
  projects: readonly { folder: string; files: readonly { path: string; content: string }[] }[],
): Map<string, Map<string, unknown>> {
  const byFolder = new Map<string, Map<string, unknown>>();
  for (const project of projects) {
    const own = new Map<string, unknown>();
    const shipped = new Map<string, unknown>();
    for (const file of project.files) {
      const match = FILE.exec(file.path);
      if (!match) continue;
      // What Artisan ships is read for the common components only.
      if (match[1] && project.folder !== COMMON) continue;
      const into = match[1] ? shipped : own;
      if (into.has(match[2]!)) continue;
      try {
        const doc = parse(file.content);
        if (doc && typeof doc === "object" && !Array.isArray(doc)) into.set(match[2]!, doc);
      } catch {
        // Not a component.
      }
    }
    for (const [name, doc] of shipped) if (!own.has(name)) own.set(name, doc);
    if (own.size) byFolder.set(project.folder, own);
  }
  return byFolder;
}
