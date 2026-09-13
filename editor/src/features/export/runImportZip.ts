import type { ProjectId } from "@/domain/types";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { normalizeProjectFiles, readProjectZip } from "./projectZip";

export interface ImportProjectResult {
  newId: string;
  name: string;
}

/**
 * Import a project from a zip of its file tree — ours, or one an admin zipped
 * straight off their server. Files-first: the tree IS the project, so the
 * import is `zip → files → projectFromFiles`, with no intermediate format.
 *
 * Rejects with `not_a_zip` / `no_manifest` so the caller can say which.
 */
export async function runImportZip(
  file: Blob,
  importProjectAction: (input: { project: unknown }) => string,
  targetId?: string,
): Promise<ImportProjectResult> {
  const entries = await readProjectZip(file);
  const { projectId, files } = normalizeProjectFiles(entries, targetId);
  if (Object.values(files).some((content) => content instanceof Uint8Array))
    throw new Error("binary_import_requires_storage");
  const textFiles = Object.fromEntries(
    Object.entries(files).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const project = projectFromFiles(projectId as ProjectId, textFiles);
  const newId = importProjectAction({ project });
  return { newId, name: project.name };
}

/** Opens the OS file picker restricted to zip archives. */
export function pickProjectZipForImport(onPick: (file: File) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/zip,.zip";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) onPick(file);
  };
  input.click();
}
