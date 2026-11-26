import { readProjectZip } from "@/features/export/projectZip";
import { writeProjectFiles } from "@/lib/api/projectFiles";
import { createProject } from "@/lib/api/servers";
import { deleteUserProject } from "@/lib/api/userProjects";
import {
  type ThemeArchive,
  type ThemeArchiveError,
  themeArchiveBatches,
  themeArchiveFiles,
  themeNameFromArchive,
} from "@/lib/pack/themeArchive";

export type ThemeZipRead =
  | {
      ok: true;
      /** The theme's name the file's name gives, when it gives one. */
      name: string | undefined;
      archive: ThemeArchive;
    }
  | { ok: false; error: ThemeArchiveError | "not_a_zip" };

/** Reads a theme's archive (`lib/pack/themeArchive.ts`): its files, and the name its file gives. */
export async function readThemeZip(file: File): Promise<ThemeZipRead> {
  let entries: Record<string, string | Uint8Array>;
  try {
    entries = await readProjectZip(file);
  } catch {
    return { ok: false, error: "not_a_zip" };
  }
  const archive = themeArchiveFiles(entries);
  if (typeof archive === "string") return { ok: false, error: archive };
  return { ok: true, name: themeNameFromArchive(file.name), archive };
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Makes the theme `name` on the server from an archive's files: its folder created empty
 * (`createProject` with the role `theme`), then its files written there. A theme arrives
 * installed and not in place: it changes nothing until it is put in place. When a write is
 * refused the folder just created is taken off again, so the name stays free. Rejects with
 * the refusal's code.
 */
export async function importTheme(
  serverKeyId: string,
  name: string,
  archive: ThemeArchive,
): Promise<void> {
  const project = await createProject(serverKeyId, name, "theme");
  for (const batch of themeArchiveBatches(archive)) {
    const result = await writeProjectFiles(project.id, {
      files: Object.entries(batch.files).map(([path, content]) => ({
        path,
        content,
        base_hash: null,
      })),
      deletes: [],
      binaries: Object.entries(batch.binaries).map(([path, bytes]) => ({
        path,
        content_base64: toBase64(bytes),
        base_hash: null,
      })),
      operationId: crypto.randomUUID(),
    });
    if (result.ok) continue;
    // Half a theme is worse than none; a server that does not delete a theme keeps it.
    await deleteUserProject(project.id).catch(() => undefined);
    throw new Error(result.error === "conflict" ? "write_error" : result.error);
  }
}
