import {
  folderFromZipName,
  normalizeProjectFiles,
  readProjectZip,
} from "@/features/export/projectZip";
import { createDraft, updateDraft, uploadDraftBlob } from "@/lib/api/projectDrafts";
import {
  type ProjectFilesError,
  listServerProjects,
  readProjectFiles,
} from "@/lib/api/projectFiles";
import { type ProjectSummary, createProject } from "@/lib/api/servers";
import {
  EXPORT_NOTE,
  type ExportNote,
  fontNamesIn,
  imagePathOf,
  readExportNote,
  themeOwnNames,
  settleCopies,
} from "@/lib/pack/elsewhere";
import { KIT_SLOTS, assetNamesIn, kitProjectAmong, kitShippedName } from "@/lib/pack/kit";
import { loadUserProject } from "@/lib/api/userProjects";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import {
  type ImportChoice,
  type ImportDiff,
  type ImportMode,
  type ImportReference,
  type ImportTree,
  diffImport,
  prepareImportTree,
  resolveImport,
} from "./importMerge";

export interface ImportTarget {
  /** Real server_key id (not the URL slug). */
  serverId: string;
}

export type ImportError =
  | "not_a_zip"
  | "no_manifest"
  | "invalid_project_id"
  | "project_id_required"
  | "empty"
  | "server_offline"
  | "fetch_timeout"
  | "network_error"
  | "read_error"
  | "write_error"
  | "create_failed"
  | "invalid_name"
  | "forbidden"
  | "plugin_update_required"
  | "invalid_path"
  | "unknown";

/** The error codes `POST /servers/:server/projects` can return. */
const CREATE_ERRORS: ImportError[] = [
  "server_offline",
  "fetch_timeout",
  "network_error",
  "invalid_name",
  "forbidden",
  "plugin_update_required",
  "invalid_path",
];

function mapCreateError(code: string): ImportError {
  if (code === "unauthorized" || code === "forbidden") return "forbidden";
  return CREATE_ERRORS.includes(code as ImportError) ? (code as ImportError) : "create_failed";
}

export interface ImportPreview {
  target: ImportTarget;
  /** Disk id (folder name) — the Project's identity on the server. */
  projectId: string;
  /**
   * Internal id — the drafts' key. `null` while the Project does not exist
   * yet; reads go through the disk id, never through it.
   */
  projectRef: string | null;
  /** The folder already exists on the server (snapshot read as the reference). */
  exists: boolean;
  mode: ImportMode;
  diff: ImportDiff;
  input: ImportTree;
  reference: ImportReference;
  /** Present when the archive says what the module names elsewhere (`artisan-export.yml`). */
  elsewhere?: ImportElsewhere;
}

/**
 * What became of the images a module names elsewhere, on the server it arrives on (ADR
 * `common-images-and-themes`, decision 10). The copies the archive marks as common are settled
 * without a question; what the server lacks is told before anything is written.
 */
export interface ImportElsewhere {
  /** Copies left out: the server has the same common image under that name. */
  dropped: string[];
  /** Copies kept in the module: the server has no common image of that name, or another one. */
  kept: string[];
  /** The version of Artisan the module was exported from, when the archive says it. */
  artisan: string | null;
  /** Images of Artisan's base the module names and this server's Artisan does not have. */
  base: string[];
  /** Common images the module names as common and this server does not have. */
  common: string[];
  /** Images of other modules the server does not have: the module is absent, or holds none of that name. */
  modules: { folder: string; images: string[]; absent: boolean }[];
  /** Themes' own images the server does not have: the theme is absent, or holds none of that name. */
  themes: { folder: string; images: string[]; absent: boolean }[];
  /** Fonts the module's titles write in and no Project of the server holds. */
  fonts: string[];
}

/** Whether the server lacks something the module names: said before the import is applied. */
export const lacksElsewhere = (elsewhere: ImportElsewhere | undefined): boolean =>
  !!elsewhere &&
  (elsewhere.base.length > 0 ||
    elsewhere.common.length > 0 ||
    elsewhere.modules.length > 0 ||
    elsewhere.themes.length > 0 ||
    elsewhere.fonts.length > 0);

export type PrepareImportResult =
  | { ok: true; preview: ImportPreview }
  | { ok: false; error: ImportError };

export type ApplyImportResult =
  | { ok: true; projectId: string; created: boolean; conflicts: number }
  | { ok: false; error: ImportError };

const EMPTY_REFERENCE: ImportReference = { files: {}, binaries: {} };

/**
 * The path as the draft snapshot accepts it. A file outside that domain
 * cannot live in a draft: it is skipped rather than failing the whole import.
 */
function isDraftPath(path: string): boolean {
  if (path.length === 0 || path.length > 512 || /[\\:]/.test(path)) return false;
  if (![...path].every((char) => char.charCodeAt(0) >= 32)) return false;
  if (
    !path
      .split("/")
      .every(
        (part) =>
          part !== "" &&
          part !== "." &&
          part !== ".." &&
          !["__proto__", "constructor", "prototype"].includes(part),
      )
  )
    return false;
  return !path.startsWith(".") || path === ".artisan/editor.yaml";
}

function referenceOf(
  files: Record<string, string>,
  binaries: { path: string; hash: string; size: number }[],
): ImportReference {
  return {
    files,
    binaries: Object.fromEntries(binaries.map((b) => [b.path, { hash: b.hash, size: b.size }])),
  };
}

/**
 * Reads the ZIP, resolves its identity, reads the server's current snapshot
 * and computes the conflicts. Writes nothing — the caller decides whether to
 * apply.
 */
export async function prepareImportZip(
  file: Blob,
  target: ImportTarget,
  mode: ImportMode,
): Promise<PrepareImportResult> {
  let raw: Record<string, string | Uint8Array>;
  let normalized: { projectId: string; files: Record<string, string | Uint8Array> };
  try {
    raw = await readProjectZip(file);
    // An export holds the module's files at its root: its file name names the module.
    const rootName = file instanceof File ? folderFromZipName(file.name) : undefined;
    normalized = normalizeProjectFiles(raw, undefined, rootName);
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown";
    return {
      ok: false,
      error:
        code === "no_manifest" ||
        code === "invalid_project_id" ||
        code === "project_id_required" ||
        code === "not_a_zip"
          ? code
          : "unknown",
    };
  }

  const prefix = `plugins/Artisan/projects/${normalized.projectId}/`;
  const relative: Record<string, string | Uint8Array> = {};
  for (const [key, content] of Object.entries(normalized.files)) {
    if (key.startsWith(prefix)) relative[key.slice(prefix.length)] = content;
  }
  // The archive's note is about the archive: it is read here and never written to the server.
  const noteText = relative[EXPORT_NOTE];
  const note = typeof noteText === "string" ? readExportNote(noteText) : null;
  delete relative[EXPORT_NOTE];
  const kept: Record<string, string | Uint8Array> = {};
  for (const [path, content] of Object.entries(relative)) {
    if (isDraftPath(path)) kept[path] = content;
    else console.warn(`[import] path skipped (invalid for a draft): ${path}`);
  }
  const input = await prepareImportTree(kept);
  if (Object.keys(input.files).length === 0 && Object.keys(input.binaries).length === 0)
    return { ok: false, error: "empty" };

  const listing = await listServerProjects(target.serverId);
  if (!listing.ok) return { ok: false, error: filesError(listing.error) };
  const summary = listing.projects?.find(
    (project) => (project.externalId ?? project.id) === normalized.projectId,
  );
  const exists = Boolean(summary) || listing.projectIds.includes(normalized.projectId);
  // The draft is keyed on the internal id: a folder name already taken by
  // another server yields a distinct internal id (never `getProject` on a
  // diskId).
  const projectRef = summary?.id ?? null;
  if (exists && !projectRef) return { ok: false, error: "read_error" };

  let elsewhere: ImportElsewhere | undefined;
  if (note) {
    const settled = await settleElsewhere(
      note,
      input,
      target,
      normalized.projectId,
      listing.projects ?? [],
      listing.projectIds,
    );
    if (!settled.ok) return settled;
    elsewhere = settled.elsewhere;
  }

  let reference = EMPTY_REFERENCE;
  if (exists) {
    const read = await readProjectFiles({
      serverId: target.serverId,
      diskId: normalized.projectId,
    });
    if (!read.ok) return { ok: false, error: filesError(read.error) };
    if (read.unchanged) return { ok: false, error: "read_error" };
    reference = referenceOf(read.files, read.binaries ?? []);
  }

  return {
    ok: true,
    preview: {
      target,
      projectId: normalized.projectId,
      projectRef,
      exists,
      mode,
      diff: diffImport(input, reference),
      input,
      reference,
      ...(elsewhere ? { elsewhere } : {}),
    },
  };
}

const folderOf = (summary: ProjectSummary): string => summary.externalId ?? summary.id;

/**
 * Settles what the archive's `note` says against the server: the copies of common images it
 * already has leave `input`, and what it lacks is listed. Reads the common images' Project,
 * and each module and theme the note names that the server has.
 */
async function settleElsewhere(
  note: ExportNote,
  input: ImportTree,
  target: ImportTarget,
  moduleId: string,
  summaries: ProjectSummary[],
  folders: string[],
): Promise<{ ok: true; elsewhere: ImportElsewhere } | { ok: false; error: ImportError }> {
  const base = new Set(KIT_SLOTS.map((slot) => slot.id));
  const hashes = new Map<string, string>();
  // The fonts the note names that nothing read so far holds: the archive itself, then the server's Projects.
  const inArchive = fontNamesIn([...Object.keys(input.files), ...Object.keys(input.binaries)]);
  const fonts = new Set((note.requires.fonts ?? []).filter((font) => !inArchive.has(font)));
  const holdsFonts = (read: { files: Record<string, string>; binaries?: { path: string }[] }) => {
    for (const font of fontNamesIn([
      ...Object.keys(read.files),
      ...(read.binaries ?? []).map((b) => b.path),
    ]))
      fonts.delete(font);
  };
  const kit = kitProjectAmong(summaries, folderOf);
  if (kit) {
    const read = await readProjectFiles({ serverId: target.serverId, diskId: folderOf(kit) });
    if (!read.ok) return { ok: false, error: filesError(read.error) };
    if (read.unchanged) return { ok: false, error: "read_error" };
    const binaries = new Map((read.binaries ?? []).map((b) => [b.path, b.hash]));
    holdsFonts(read);
    for (const path of binaries.keys()) {
      const name = kitShippedName(path);
      if (name) base.add(name);
    }
    for (const name of [...note.common, ...note.requires.common]) {
      const path = imagePathOf(name, (p) => binaries.has(p));
      if (path) hashes.set(name, binaries.get(path)!);
    }
    // A composed common image has no PNG: its descriptor is what holds its name.
    for (const name of assetNamesIn(Object.keys(read.files).filter((p) => p.startsWith("assets/"))))
      if (!hashes.has(name)) hashes.set(name, "");
  }

  const settled = settleCopies(
    note,
    input.binaries,
    Object.keys(input.files),
    (name) => hashes.get(name) || null,
  );
  for (const { paths } of settled.dropped)
    for (const path of paths) {
      delete input.binaries[path];
      delete input.files[path];
    }

  const modules: ImportElsewhere["modules"] = [];
  for (const [folder, images] of Object.entries(note.requires.modules)) {
    if (folder === moduleId) continue;
    const summary = summaries.find((s) => folderOf(s) === folder);
    if (!summary && !folders.includes(folder)) {
      modules.push({ folder, images, absent: true });
      continue;
    }
    const read = await readProjectFiles({ serverId: target.serverId, diskId: folder });
    // A module that cannot be read is not said to lack anything: the import does not depend on it.
    if (!read.ok || read.unchanged) continue;
    holdsFonts(read);
    const held = new Set(
      assetNamesIn([...Object.keys(read.files), ...(read.binaries ?? []).map((b) => b.path)]),
    );
    const lacking = images.filter((name) => !held.has(name));
    if (lacking.length > 0) modules.push({ folder, images: lacking, absent: false });
  }

  // A font is the server's, whoever holds it: the other modules are read until each is found.
  // The module itself counts as the archive has it; a module that cannot be read holds none.
  for (const summary of summaries) {
    if (fonts.size === 0) break;
    const folder = folderOf(summary);
    if (summary.role || summary.id === kit?.id || folder === moduleId) continue;
    if (folder in note.requires.modules) continue;
    const read = await readProjectFiles({ serverId: target.serverId, diskId: folder });
    if (read.ok && !read.unchanged) holdsFonts(read);
  }

  // A theme's own image is `<theme>:<name>` where a theme of that folder holds it.
  const themes: ImportElsewhere["themes"] = [];
  for (const [folder, images] of Object.entries(note.requires.themes ?? {})) {
    const summary = summaries.find((s) => folderOf(s) === folder && s.role === "theme");
    if (!summary || summary.id === kit?.id) {
      themes.push({ folder, images, absent: true });
      continue;
    }
    const read = await readProjectFiles({ serverId: target.serverId, diskId: folder });
    // A theme that cannot be read is not said to lack anything.
    if (!read.ok || read.unchanged) continue;
    const held = themeOwnNames({
      files: Object.entries(read.files).map(([path, content]) => ({ path, content })),
      binaries: (read.binaries ?? []).map((b) => ({ ...b, size: 0 })),
    });
    const lacking = images.filter((name) => !held.has(name));
    if (lacking.length > 0) themes.push({ folder, images: lacking, absent: false });
  }

  return {
    ok: true,
    elsewhere: {
      dropped: settled.dropped.map((copy) => copy.name),
      kept: settled.kept,
      artisan: note.artisan,
      base: note.base.filter((name) => !base.has(name)),
      common: note.requires.common.filter((name) => !hashes.has(name) && !base.has(name)),
      modules,
      themes,
      fonts: [...fonts].sort(),
    },
  };
}

/**
 * Applies the import to the Project's **draft** (never directly to the disk):
 * the admin reviews and deploys. Creates the Project if it does not exist yet.
 */
export async function applyImportZip(
  preview: ImportPreview,
  choices: Record<string, ImportChoice> = {},
): Promise<ApplyImportResult> {
  const { target, projectId } = preview;
  let created = false;
  let projectRef = preview.projectRef;
  let reference = preview.reference;

  if (!preview.exists) {
    try {
      const project = await createProject(target.serverId, projectId);
      projectRef = project.id;
      created = true;
    } catch (error) {
      const code = error instanceof Error ? error.message : "create_failed";
      if (code === "project_exists") {
        // The listing did not see it yet, but the server holds it: resolve its
        // internal anchor and the import becomes an update, not a failure.
        try {
          const resolved = await loadUserProject(projectId, target.serverId);
          projectRef = resolved.project.id;
        } catch {
          console.error("[import] project_exists but the anchor cannot be found");
          return { ok: false, error: "create_failed" };
        }
      } else {
        console.error("[import] createProject failed:", code);
        return { ok: false, error: mapCreateError(code) };
      }
    }
    // The new Project may carry an anchoring module file: the draft's base
    // must reflect it, otherwise publishing would conflict.
    const read = await readProjectFiles({ serverId: target.serverId, diskId: projectId });
    if (read.ok && !read.unchanged) reference = referenceOf(read.files, read.binaries ?? []);
    else if (!read.ok && read.error !== "server_offline")
      return { ok: false, error: filesError(read.error) };
  }

  // Without an internal anchor, drafts have no key: never the disk id.
  if (!projectRef) return { ok: false, error: "create_failed" };

  const resolved = resolveImport(preview.input, reference, preview.mode, choices);
  const snapshot = {
    baseline: reference.files,
    tree: resolved.files,
    initialTree: reference.files,
    binaryBaseline: reference.binaries,
    binaryTree: reference.binaries,
    at: Date.now(),
  };

  const draftId = crypto.randomUUID();
  const name = projectId.slice(0, 120);
  try {
    const createdDraft = await createDraft(
      projectRef,
      draftId,
      name,
      snapshot,
      crypto.randomUUID(),
    );
    const changed = Object.entries(resolved.binaries)
      .filter(([path, meta]) => reference.binaries[path]?.hash !== meta.hash)
      .map(([, meta]) => meta);
    // An image removed by the overwrite counts too: without an update, the
    // draft would keep the server's image tree.
    const removed = Object.keys(reference.binaries).some((path) => !(path in resolved.binaries));
    if (changed.length > 0 || removed) {
      for (const meta of changed) {
        if (!meta.bytes) continue;
        await uploadDraftBlob(
          projectRef,
          draftId,
          createdDraft.revision,
          meta.hash,
          toBase64(meta.bytes),
          crypto.randomUUID(),
        );
      }
      await updateDraft(
        projectRef,
        draftId,
        createdDraft.revision,
        name,
        {
          ...snapshot,
          binaryTree: Object.fromEntries(
            Object.entries(resolved.binaries).map(([path, meta]) => [
              path,
              { hash: meta.hash, size: meta.size },
            ]),
          ),
        },
        crypto.randomUUID(),
      );
    }
  } catch {
    return { ok: false, error: "write_error" };
  }

  // The freshly created server draft must become the session's: an older local
  // draft would hijack the selection on open. The local store is keyed on the
  // internal id, not on the folder name.
  useProjectDraftStore.getState().clear(projectRef);
  return { ok: true, projectId, created, conflicts: preview.diff.conflicts.length };
}

function filesError(error: ProjectFilesError): ImportError {
  return error === "server_offline" ||
    error === "fetch_timeout" ||
    error === "network_error" ||
    error === "read_error"
    ? error
    : "read_error";
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
