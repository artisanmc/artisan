import { normalizeProjectFiles, readProjectZip } from "@/features/export/projectZip";
import { createProject } from "@/lib/api/networks";
import { createDraft, updateDraft, uploadDraftBlob } from "@/lib/api/projectDrafts";
import {
  type ProjectFilesError,
  listServerProjects,
  readProjectFiles,
} from "@/lib/api/projectFiles";
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
  networkId: string;
  /** Id réel du server_key (pas le slug d'URL). */
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
  | "unknown";

export interface ImportPreview {
  target: ImportTarget;
  /** Id disque (nom de dossier) — l'identité du Project côté serveur. */
  projectId: string;
  /**
   * Id interne backend — la clé des brouillons. `null` tant que le Project
   * n'existe pas encore ; les lectures passent par l'id disque, jamais par lui.
   */
  projectRef: string | null;
  /** Le dossier existe déjà sur le serveur (instantané lu comme référence). */
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
 * Le chemin tel que le snapshot de brouillon backend l'accepte
 * (`validSnapshot` dans `backend/src/lib/projectDrafts.ts`). Un fichier hors de
 * ce domaine ne peut pas vivre dans un brouillon : on l'écarte plutôt que de
 * faire échouer tout l'import.
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
 * Lit le ZIP, résout son identité, lit l'instantané courant du serveur (miroir)
 * et calcule les conflits. N'écrit rien — l'appelant décide de l'application.
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
    else console.warn(`[import] chemin ignoré (invalide pour un brouillon) : ${path}`);
  }
  const input = await prepareImportTree(kept);
  if (Object.keys(input.files).length === 0 && Object.keys(input.binaries).length === 0)
    return { ok: false, error: "empty" };

  const listing = await listServerProjects(target.networkId, target.serverId);
  if (!listing.ok) return { ok: false, error: filesError(listing.error) };
  const summary = listing.projects?.find(
    (project) => (project.externalId ?? project.id) === normalized.projectId,
  );
  const exists = Boolean(summary) || listing.projectIds.includes(normalized.projectId);
  // Le brouillon se keye sur l'id interne : un nom de dossier déjà pris par un
  // autre serveur donne un id interne distinct (jamais `getProject` sur un
  // diskId, incident cross-tenant 2026-08-12).
  const projectRef = summary?.id ?? null;
  if (exists && !projectRef) return { ok: false, error: "read_error" };

  let reference = EMPTY_REFERENCE;
  if (exists) {
    const read = await readProjectFiles(target.networkId, target.serverId, normalized.projectId);
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
 * Applique l'import dans le **brouillon** du Project (jamais directement sur le
 * disque) : l'admin relit et déploie. Crée le Project s'il n'existe pas encore.
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
      const project = await createProject(target.networkId, target.serverId, projectId);
      projectRef = project.id;
      created = true;
    } catch (error) {
      // Course : un autre onglet l'a créé entre-temps — on lit son état.
      if (!(error instanceof Error && error.message === "project_exists"))
        return {
          ok: false,
          error:
            error instanceof Error && error.message.includes("server")
              ? "server_offline"
              : "create_failed",
        };
    }
    // Le Project neuf peut porter un `manifest.yaml` d'ancrage : la base du
    // brouillon doit le refléter, sinon la publication entrerait en conflit.
    const read = await readProjectFiles(target.networkId, target.serverId, projectId);
    if (read.ok && !read.unchanged) reference = referenceOf(read.files, read.binaries ?? []);
    else if (!read.ok && read.error !== "server_offline")
      return { ok: false, error: filesError(read.error) };
  }

  // Sans ancre interne, les brouillons n'ont pas de clé : jamais l'id disque.
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
    if (changed.length > 0) {
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

  // Le brouillon backend fraîchement créé doit devenir celui de la session :
  // un brouillon local plus ancien détournerait la sélection à l'ouverture.
  // Le store local est keyé sur l'id interne, pas sur le nom de dossier.
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
