import type { ActiveModule } from "@/lib/api/modules";
import type { FileOrigin, TemplateInfo } from "@/lib/api/templates";
import { sameYamlFile, yamlPathFor } from "@/lib/yamlFiles";

/**
 * A template file seen from a Project (ADR `module-templates`), from the origins the server
 * recorded at the copy and the hashes of the Project's files:
 * - `absent`: never copied here, no file at that path;
 * - `occupied`: a file of the Project's own sits at that path (a copy would ask to replace it);
 * - `identical`: copied, untouched since;
 * - `modified`: copied, then edited;
 * - `removed`: copied, then deleted (or renamed: a renamed file is the owner's).
 */
export type TemplateFileStatus = "absent" | "occupied" | "identical" | "modified" | "removed";

export interface TemplateFileState {
  /** The file as the module ships it, what a copy names. */
  path: string;
  /** Where it is, or would land, in the Project: `menus/daily.yml` for a shipped `menus/daily.yaml`. */
  projectPath: string;
  status: TemplateFileStatus;
  /** The module ships another version of this file than the one copied here: the owner may take it. */
  updateAvailable: boolean;
}

export interface TemplateState {
  moduleId: string;
  template: TemplateInfo;
  files: TemplateFileState[];
  /** At least one file was copied into this Project. */
  copied: boolean;
  /** At least one copied file has a newer shipped version. */
  updateAvailable: boolean;
}

/**
 * The state of each file of `template` in a Project whose files hash to `projectHashes`
 * (path → SHA-256 of the published content) and whose copies came from `origins`.
 */
export function templateState(
  moduleId: string,
  template: TemplateInfo,
  origins: Record<string, FileOrigin>,
  projectHashes: Record<string, string>,
): TemplateState {
  const files = template.files.map((file): TemplateFileState => {
    // A YAML file under the spelling the Project gives it, else `.yml` (as the copy writes it).
    const at = yamlPathFor(file.path, { ...origins, ...projectHashes });
    const paths = { path: file.path, projectPath: at };
    const current = projectHashes[at];
    const origin = origins[at];
    const fromHere = origin && origin.module === moduleId && origin.template === template.id;
    if (!fromHere) {
      // Same content as shipped is a copy in all but name: nothing to offer.
      if (current === undefined) return { ...paths, status: "absent", updateAvailable: false };
      return {
        ...paths,
        status: current === file.hash ? "identical" : "occupied",
        updateAvailable: false,
      };
    }
    const updateAvailable = origin.hash !== file.hash && current !== file.hash;
    if (current === undefined) return { ...paths, status: "removed", updateAvailable };
    if (current === file.hash) return { ...paths, status: "identical", updateAvailable: false };
    return {
      ...paths,
      status: current === origin.hash ? "identical" : "modified",
      updateAvailable,
    };
  });
  return {
    moduleId,
    template,
    files,
    copied: files.some((f) => f.status !== "absent" && f.status !== "occupied"),
    updateAvailable: files.some((f) => f.updateAvailable),
  };
}

/** Every template the server's active modules announce, with the module that ships it. */
export function announcedTemplates(
  modules: ActiveModule[],
): { moduleId: string; template: TemplateInfo }[] {
  return modules.flatMap((m) =>
    (m.templates ?? []).map((template) => ({ moduleId: m.id, template })),
  );
}

/**
 * The template file a Project file was copied from, when that template is still announced:
 * the per-document badge of the tree and the "reset" action read it.
 */
export function originOf(
  path: string,
  origins: Record<string, FileOrigin>,
  modules: ActiveModule[],
): { moduleId: string; template: TemplateInfo; origin: FileOrigin } | null {
  const origin = origins[path];
  if (!origin) return null;
  const template = modules
    .find((m) => m.id === origin.module)
    ?.templates?.find((t) => t.id === origin.template);
  if (!template?.files.some((f) => sameYamlFile(f.path, path))) return null;
  return { moduleId: origin.module, template, origin };
}
