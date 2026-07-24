import { parse as parseYaml } from "yaml";

// Small file-tree readers over a project's canonical files (files-first: the
// tree is the only stored representation). The FULL files → domain importer
// lives editor-side (editor/src/schema/projectFromFiles.ts) — the backend only
// needs targeted manifest reads.

function getFile(files: Record<string, string>, projectId: string, rel: string): string | null {
  return files[`plugins/Artisan/projects/${projectId}/${rel}`] ?? null;
}

function tryParse<T>(text: string | null): T | null {
  if (!text) return null;
  try { return parseYaml(text) as T; } catch { return null; }
}

/** The owning Add-on module id declared in `manifest.module`, or undefined. */
export function readOwnerModuleFromFiles(
  files: Record<string, string>,
  projectId: string,
): string | undefined {
  const m = tryParse<{ module?: unknown }>(getFile(files, projectId, "manifest.yaml")) ?? {};
  return typeof m.module === "string" && m.module ? m.module : undefined;
}
