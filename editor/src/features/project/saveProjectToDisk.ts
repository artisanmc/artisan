import { rekeyProject } from "@/domain/i18nSites";
import type { Project } from "@/domain/types";
import { transform } from "@/features/export/transform";
import { writeProjectFiles, type ProjectFileConflict, type ProjectFilesError } from "@/lib/api/projectFiles";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { applyRenames, planWrite, toRelative } from "./diskSave";
import { publishBackendDraft, useBackendDraftStore } from "./backendDrafts";
import { DraftApiError } from "@/lib/api/projectDrafts";

/** L'arbre rel-keyed que produirait un enregistrement de [project], sans écrire. */
export function projectTree(project: Project): Record<string, string> {
  const cloned = structuredClone(project);
  rekeyProject(cloned);
  return toRelative(transform(cloned), project.diskId ?? project.id);
}

/**
 * Réintègre dans le Project le contenu disque que l'admin a choisi de garder.
 *
 * On repart de l'arbre courant de l'éditeur — donc **les éditions non
 * conflictuelles survivent** — on y remplace les seuls fichiers tranchés en
 * faveur du serveur, et on re-parse. Pas de fusion ligne à ligne : le choix est
 * au niveau fichier, comme partout ailleurs dans le modèle.
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
  return projectFromFiles(project.id, canonical, {
    name: project.name,
    diskId: project.diskId,
    slug: project.slug,
    serverKeyId: project.serverKeyId,
  });
}

export type SaveToDiskResult =
  | { ok: true; wrote: number }
  | {
      ok: false;
      error: "conflict";
      conflicts: ProjectFileConflict[];
      /** L'état réel du dossier au moment du conflit — voir un renommage. */
      diskFiles: string[];
    }
  | { ok: false; error: ProjectFilesError };

/**
 * Enregistre un Project sur le disque de son serveur (ADR
 * `server-disk-only-storage`, P2) — le seul chemin par lequel du contenu atteint
 * le disque depuis l'éditeur.
 *
 * Remplace `persistProject` : plus de copie backend, plus d'auto-save. Le geste
 * est explicite, et ce qui n'a pas été enregistré vit dans la page — comme dans
 * n'importe quel éditeur.
 */
export async function saveProjectToDisk(
  project: Project,
  networkId: string,
  serverId: string,
): Promise<SaveToDiskResult> {
  const diskId = project.diskId ?? project.id;
  const next = projectTree(project);

  const store = useProjectBaselineStore.getState();
  // Pas de base = ce Project n'a jamais été lu sur le disque, donc il n'y est
  // pas encore : c'est une création ou un import, et l'écriture doit le dire.
  const known = store.get(project.id);
  const baseline = known ?? {};
  if (useBackendDraftStore.getState().sessions[project.id]) {
    const previous = useProjectDraftStore.getState().get(project.id);
    useProjectDraftStore.getState().save(project.id, { ...previous, baseline, tree: next,
      initialTree: previous?.initialTree ?? baseline, at: previous?.at ?? Date.now() });
    try {
      const result = await publishBackendDraft(project.id);
      if (!result) return { ok: false, error: "write_error" };
      store.set(project.id, next);
      const current = useProjectDraftStore.getState().get(project.id);
      if (current && JSON.stringify(current.tree) !== JSON.stringify(next)) {
        useProjectDraftStore.getState().save(project.id, { ...current, remote: undefined, baseline: next, initialTree: next, at: Date.now() });
      } else useProjectDraftStore.getState().clear(project.id);
      return { ok: true, wrote: result.wrote };
    } catch (error) {
      if (error instanceof DraftApiError && error.code === "conflict") return { ok: false, error: "conflict", conflicts: error.conflicts, diskFiles: error.diskFiles };
      return { ok: false, error: error instanceof DraftApiError && error.code === "server_offline" ? "server_offline" : "write_error" };
    }
  }
  // Les renommages déclarés transforment « supprimer + créer » en déplacement :
  // seule l'intention de l'éditeur permet de les distinguer.
  const declared = useProjectDraftStore.getState().pendingRenames[project.id] ?? [];
  const plan = await applyRenames(await planWrite(baseline, next), declared, baseline);
  // Rien n'a bougé : on s'épargne l'aller-retour, et surtout on n'écrit pas des
  // fichiers identiques (ce qui polluerait la corbeille pour rien).
  if (plan.empty) return { ok: true, wrote: 0 };

  const res = await writeProjectFiles(networkId, serverId, diskId, { ...plan, create: known === undefined });
  if (!res.ok) {
    // Un conflit n'avance PAS la base : le plugin n'a rien écrit, donc ce qu'on
    // croit savoir du disque reste ce qu'on avait chargé.
    return res;
  }
  store.set(project.id, next);
  // Le travail est parti sur le serveur : le brouillon n'a plus rien à sauver.
  // Le laisser ferait proposer « reprendre mon travail » sur du déjà-enregistré.
  useProjectDraftStore.getState().clear(project.id);
  return { ok: true, wrote: plan.files.length + plan.deletes.length + plan.renames.length };
}
