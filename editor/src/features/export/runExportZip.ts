import type { Project } from "@/domain/types";
import { persistProject } from "@/features/project/persistProject";
import { loadUserProject } from "@/lib/api/userProjects";
import { buildZip } from "./buildZip";

export interface ExportZipResult {
  ok: boolean;
  /** Set when the export could not be produced. */
  error?: "not_signed_in" | "transport";
}

/**
 * Download the project's file tree **exactly as the server stores it**, zipped.
 *
 * The archive is the disk truth (files-first), not a regeneration from the
 * in-memory domain: it therefore carries what the domain does not model — the
 * `.artisan/editor.yaml` board state, and an Add-on root's own files. And it is
 * never gated on validation: getting your files out must not depend on their
 * being valid, which is the whole anti-lock-in promise.
 *
 * The pending auto-save is flushed first, otherwise the archive would lag the
 * editor by the debounce window.
 */
export async function runExportZip(project: Project, hasUser: boolean): Promise<ExportZipResult> {
  if (!hasUser) return { ok: false, error: "not_signed_in" };
  try {
    await persistProject(project, hasUser);
    const { files } = await loadUserProject(project.id);
    const blob = await buildZip(files);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.id}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return { ok: true };
  } catch {
    return { ok: false, error: "transport" };
  }
}
