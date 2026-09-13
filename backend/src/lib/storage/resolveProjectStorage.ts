import type { Capability } from "../capabilities";
import { requireCapability, requireMember } from "../membershipGuard";
import { getProject, projectDiskId, type Project } from "../projectStorage";
import type { ProjectLocation, ProjectStorage } from "./ProjectStorage";
import { ServerProjectStorage } from "./ServerProjectStorage";
import { resolveDraftStore } from "./resolveDraftStore";
import { openHostedProjectStorage } from "./hostedProjects";
import {authorizeProjectPrincipal,type ProjectPrincipal} from '../projectPrincipal';
import {openDemoProjectStorage} from '../demoSessions';

export class ProjectStorageError extends Error {
  constructor(readonly code: "not_found" | "forbidden" | "storage_unavailable" | "invalid_location") {
    super(code);
  }
}

export function projectLocation(project: Pick<Project, "id" | "externalId" | "serverKeyId" | "storageKind" | "hostedRootId">): ProjectLocation {
  const folderName = projectDiskId(project);
  switch (project.storageKind) {
    case "server":
      if (!project.serverKeyId || project.hostedRootId !== null) throw new ProjectStorageError("invalid_location");
      return { kind: "server", serverKeyId: project.serverKeyId, folderName };
    case "hosted":
      if (project.serverKeyId !== null || !project.hostedRootId || !/^[a-zA-Z0-9_-]+$/.test(project.hostedRootId) || !project.externalId || !/^[a-zA-Z0-9_-]+$/.test(project.externalId)) throw new ProjectStorageError("invalid_location");
      return { kind: "hosted", rootId: project.hostedRootId, folderName };
    default:
      throw new ProjectStorageError("invalid_location");
  }
}

interface StorageFactories {
  server: (location: Extract<ProjectLocation, { kind: "server" }>, project?: Project, ownerId?: string) => ProjectStorage | Promise<ProjectStorage>;
  hosted: (location: Extract<ProjectLocation, { kind: "hosted" }>, project?:Project, ownerId?:string) => ProjectStorage | Promise<ProjectStorage>;
}
const defaultFactories: StorageFactories = {
  server: async (location, project, ownerId) => {
    const storage = new ServerProjectStorage(location, {}, project ? { id: project.id, kind: project.identityKind } : undefined);
    if (project && ownerId) storage.bindDraftStore(await resolveDraftStore(project, ownerId, storage));
    return storage;
  },
  hosted: async (_location,project,ownerId) => { if(!project||!ownerId)throw new ProjectStorageError("storage_unavailable");return openHostedProjectStorage(project,ownerId); },
};

interface ResolverDependencies {
  findProject: typeof getProject;
  authorize: (userId: ProjectPrincipal, project: Project, capability?: Capability) => Promise<void>;
  factories: StorageFactories;
}
const defaults: ResolverDependencies = {
  findProject: getProject,
  authorize: authorizeProjectPrincipal,
  factories: defaultFactories,
};

/** Authorization precedes all location resolution, including opening a backend root. */
export function createProjectStorageResolver(dependencies: ResolverDependencies = defaults) {
  return async (userId: ProjectPrincipal, projectId: string, capability?: Capability): Promise<ProjectStorage> => {
    const project = await dependencies.findProject(projectId);
    if (!project || project.deletedAt) throw new ProjectStorageError("not_found");
    try { await dependencies.authorize(userId, project, capability); }
    catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "forbidden") throw new ProjectStorageError("forbidden");
      throw error;
    }
    const location = projectLocation(project);
    if(typeof userId!=='string') return openDemoProjectStorage(userId,project);
    switch (location.kind) {
      case "server": return dependencies.factories.server(location, project, userId);
      case "hosted": return dependencies.factories.hosted(location,project,userId);
    }
  };
}

export const resolveProjectStorage = createProjectStorageResolver();
