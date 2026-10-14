import { normalizeProjectFiles, readProjectZip } from "@/features/export/projectZip";
import { createDraft, updateDraft, uploadDraftBlob } from "@/lib/api/projectDrafts";
import {
  type ProjectFilesError,
  listServerProjects,
  readProjectFiles,
} from "@/lib/api/projectFiles";
import { createProject } from "@/lib/api/servers";
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
}

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
    normalized = normalizeProjectFiles(raw);
  } catch (error) {
    const code = error instanceof Error ? error.message : "unknown";
    return {
      ok: false,
      error:
        code === "no_manifest" || code === "invalid_project_id" || code === "not_a_zip"
          ? code
          : "unknown",
    };
  }

  const prefix = `plugins/Artisan/projects/${normalized.projectId}/`;
  const relative: Record<string, string | Uint8Array> = {};
  for (const [key, content] of Object.entries(normalized.files)) {
    if (key.startsWith(prefix)) relative[key.slice(prefix.length)] = content;
  }
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
    // The new Project may carry an anchoring `manifest.yaml`: the draft's base
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
