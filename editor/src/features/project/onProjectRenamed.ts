import { useAccountStore } from "@/state/accountStore";
import { useProjectCacheStore } from "@/state/projectCacheStore";
import { flushDraftEdits } from "./draftFlush";

export interface ProjectRenamed {
  serverKeyId: string;
  projectId: string;
  previousDiskId: string;
  diskId: string;
}

export function onProjectRenamed(event: ProjectRenamed): void {
  const renamedName = (name: string | undefined) =>
    name === event.previousDiskId ? event.diskId : name;
  flushDraftEdits();
  const account = useAccountStore.getState().account;
  let changed = false;
  const projects = account.projects.map((project) => {
    if (
      project.id !== event.projectId ||
      project.serverKeyId !== event.serverKeyId ||
      (project.diskId ?? project.id) !== event.previousDiskId
    )
      return project;
    changed = true;
    return { ...project, diskId: event.diskId, name: renamedName(project.name)! };
  });
  if (changed) useAccountStore.getState().setAccount({ ...account, projects });
  const cache = useProjectCacheStore.getState();
  for (const [key, entry] of Object.entries(cache.entries)) {
    const identity = entry.identity as
      | { project?: { id?: string; externalId?: string; name?: string } }
      | undefined;
    if (
      entry.serverKeyId !== event.serverKeyId ||
      entry.diskId !== event.previousDiskId ||
      identity?.project?.id !== event.projectId
    )
      continue;
    changed = true;
    cache.put(key, {
      ...entry,
      diskId: event.diskId,
      hash: null,
      identity: {
        ...identity,
        project: {
          ...identity.project,
          externalId: event.diskId,
          name: renamedName(identity.project.name),
        },
      },
    });
  }
  // The loader retains relative draft trees and their original CAS baselines.
  if (changed) cache.requestReload();
  window.dispatchEvent(new CustomEvent<ProjectRenamed>("ifz:project_renamed", { detail: event }));
}
