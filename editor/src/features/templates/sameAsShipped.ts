import type { Project } from "@/domain/types";
import { adoptDiskIntoProject, projectTree } from "@/features/project/saveProjectToDisk";
import { sameYamlValue } from "@/lib/yamlEquivalence";

const cache = new WeakMap<Project, Map<string, boolean>>();

/**
 * Does `published` say what `shipped` says, once both are read and written back by the
 * editor? A file deployed from the editor is written in its canonical form, never byte for
 * byte as the module ships it, and a jar built on Windows ships CRLF: only a difference that
 * survives that round trip is an edit.
 */
export function sameAsShipped(
  project: Project,
  path: string,
  published: string,
  shipped: string,
): boolean {
  if (published === shipped || sameYamlValue(published, shipped)) return true;
  let known = cache.get(project);
  if (!known) {
    known = new Map();
    cache.set(project, known);
  }
  const key = `${path}\u0000${published}\u0000${shipped}`;
  const hit = known.get(key);
  if (hit !== undefined) return hit;
  const canonical = (content: string) =>
    projectTree(adoptDiskIntoProject(project, { [path]: content }, []))[path];
  let same = false;
  try {
    const a = canonical(published);
    same = a !== undefined && a === canonical(shipped);
  } catch {
    same = false;
  }
  known.set(key, same);
  return same;
}
