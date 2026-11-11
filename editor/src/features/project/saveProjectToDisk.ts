import { isOriginalPath } from "@/domain/documentLayout";
import { rekeyProject } from "@/domain/i18nSites";
import type { Project } from "@/domain/types";
import { showOriginal, showVariant, viewedVariant } from "@/domain/variants";
import { DraftApiError } from "@/lib/api/projectDrafts";
import type { ProjectFileConflict, ProjectFilesError } from "@/lib/api/projectFiles";
import { projectClient } from "@/lib/projectClient";
import { keepEquivalentText } from "@/lib/yamlEquivalence";
import { keepYamlExtensions, yamlPathOnDisk } from "@/lib/yamlFiles";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { projectToFiles } from "@/schema/projectToFiles";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { applyRenames, planWrite, toRelative } from "./diskSave";
import { publishPersistedDraft, usePersistedDraftStore } from "./persistedDrafts";

/**
 * The rel-keyed tree a save of [project] would produce, without writing. A YAML file keeps
 * the extension it has on disk (`keepYamlExtensions`), and its text when the editor did not
 * change its value (`keepEquivalentText`): only real edits are deployed.
 */
export function projectTree(project: Project): Record<string, string> {
  const cloned = structuredClone(project);
  // Before the keys are canonicalized: a variant's version must not take its module twin's.
  showOriginal(cloned, false);
  showVariant(cloned, undefined);
  rekeyProject(cloned);
  const disk = useProjectBaselineStore.getState().get(project.id);
  const tree = keepEquivalentText(
    keepYamlExtensions(toRelative(projectToFiles(cloned), project.diskId ?? project.id), disk),
    disk,
  );
  // The module's originals are the server's: carried as they are on disk, never written.
  for (const [path, text] of Object.entries(disk ?? {}))
    if (isOriginalPath(path)) tree[path] = text;
  return tree;
}

/**
 * Brings the disk content the admin chose to keep back into the Project.
 *
 * Starts from the editor's current tree — so **non-conflicting edits
 * survive** — replaces only the files resolved in the server's favour, and
 * re-parses. No line-by-line merge: the choice is per file, as everywhere
 * else in the model.
 */
export function adoptDiskIntoProject(
  project: Project,
  adoptFromDisk: Record<string, string>,
  removeFromTree: string[],
): Project {
  const diskId = project.diskId ?? project.id;
  const tree = { ...projectTree(project), ...adoptFromDisk };
  for (const path of removeFromTree) delete tree[path];
  const canonical: Record<string, string> = {};
  for (const [rel, content] of Object.entries(tree)) {
    canonical[`plugins/Artisan/projects/${diskId}/${rel}`] = content;
  }
  const adopted = projectFromFiles(project.id, canonical, {
    name: project.name,
    diskId: project.diskId,
    serverKeyId: project.serverKeyId,
  });
  // The canvas keeps showing the variant it showed, and the original if it did.
  showVariant(adopted, viewedVariant(project) ?? project.originalView?.variant);
  if (project.originalView) showOriginal(adopted, true);
  return adopted;
}

export type SaveToDiskResult =
  | { ok: true; wrote: number }
  | {
      ok: false;
      error: "conflict";
      conflicts: ProjectFileConflict[];
      /** The folder's real state at conflict time — to spot a rename. */
      diskFiles: string[];
    }
  | { ok: false; error: ProjectFilesError; code?: string; status?: number; message?: string };

/**
 * Saves a Project to its server's disk (ADR `server-disk-only-storage`) — the
 * only path by which content reaches the disk from the editor.
 */
export async function saveProjectToDisk(
  project: Project,
  _serverId?: string,
): Promise<SaveToDiskResult> {
  const next = projectTree(project);

  const store = useProjectBaselineStore.getState();
  // No base = this Project was never read from the disk, so it is not there
  // yet: it is a create or an import, and the write must say so.
  const known = store.get(project.id);
  const baseline = known ?? {};
  if (usePersistedDraftStore.getState().sessions[project.id]) {
    const previous = useProjectDraftStore.getState().get(project.id);
    useProjectDraftStore.getState().save(project.id, {
      ...previous,
      baseline,
      tree: next,
      initialTree: previous?.initialTree ?? baseline,
      at: previous?.at ?? Date.now(),
    });
    let recovering = previous?.remote?.pendingMutation?.kind === "publish";
    let wrote = 0;
    try {
      for (;;) {
        const result = await publishPersistedDraft(project.id);
        if (!result) return { ok: false, error: "write_error" };
        const published = result.tree ?? next;
        store.set(project.id, published);
        store.setBinaries(project.id, result.binaryTree ?? {});
        const current = useProjectDraftStore.getState().get(project.id);
        if (
          current &&
          (JSON.stringify(current.tree) !== JSON.stringify(published) ||
            JSON.stringify(current.binaryTree ?? {}) !== JSON.stringify(result.binaryTree ?? {}))
        ) {
          const renames = (
            useProjectDraftStore.getState().pendingRenames[project.id] ??
            current.renames ??
            []
          )
            .map((rename) => ({
              ...rename,
              from: result.renames?.find((done) => done.from === rename.from)?.to ?? rename.from,
            }))
            .filter((rename) => rename.from !== rename.to);
          useProjectDraftStore.setState((state) => ({
            pendingRenames: { ...state.pendingRenames, [project.id]: renames },
          }));
          useProjectDraftStore.getState().save(project.id, {
            ...current,
            renames,
            restoredFrom: undefined,
            remote: undefined,
            baseline: published,
            binaryBaseline: result.binaryTree,
            initialTree: published,
            at: Date.now(),
          });
        } else useProjectDraftStore.getState().clear(project.id);
        wrote += result.wrote;
        // A retry receipt confirms the old deployment, not this click's edits.
        // Rebase above, then publish the remaining draft as a new operation.
        if (
          recovering &&
          (JSON.stringify(next) !== JSON.stringify(published) ||
            JSON.stringify(previous?.binaryTree ?? {}) !==
              JSON.stringify(result.binaryTree ?? {})) &&
          useProjectDraftStore.getState().get(project.id)
        ) {
          recovering = false;
          continue;
        }
        return { ok: true, wrote };
      }
    } catch (error) {
      if (error instanceof DraftApiError && error.code === "conflict")
        return {
          ok: false,
          error: "conflict",
          conflicts: error.conflicts,
          diskFiles: error.diskFiles,
        };
      return {
        ok: false,
        error:
          error instanceof DraftApiError && error.code === "server_offline"
            ? "server_offline"
            : "write_error",
        code:
          error instanceof DraftApiError
            ? error.code
            : error instanceof Error
              ? error.message
              : "unknown_error",
        ...(error instanceof DraftApiError ? { status: error.status, message: error.detail } : {}),
      };
    }
  }
  // Declared renames turn "delete + create" into a move: only the editor's
  // intent can tell them apart.
  const declared = (useProjectDraftStore.getState().pendingRenames[project.id] ?? []).map((r) => ({
    ...r,
    from: yamlPathOnDisk(r.from, baseline),
  }));
  const plan = await applyRenames(await planWrite(baseline, next), declared, baseline);
  // Nothing moved: skip the round trip, and above all do not write identical
  // files (which would pollute the trash for nothing).
  if (plan.empty) return { ok: true, wrote: 0 };

  const res = await projectClient(project.id).write({
    ...plan,
    operationId: crypto.randomUUID(),
    create: known === undefined,
  });
  if (!res.ok) {
    // A conflict does NOT move the base: the plugin wrote nothing, so what we
    // believe about the disk stays what we loaded.
    return res;
  }
  store.set(project.id, next);
  // The work reached the server: the draft has nothing left to save. Keeping it
  // would offer "resume my work" on already-saved content.
  useProjectDraftStore.getState().clear(project.id);
  return { ok: true, wrote: plan.files.length + plan.deletes.length + plan.renames.length };
}
