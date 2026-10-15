import { apiFetch } from "./client";

/** A server the hub serves, by its server id (the UUID of `plugins/Artisan/server-id`). */
export interface ServerSummary {
  id: string;
  label: string | null;
  /** A plugin is connected right now. Without it, its Projects are not listed —
   *  its disk holds them (ADR `server-disk-only-storage`). */
  online: boolean;
  minecraftVersion: string | null;
  pluginVersion?: string | null;
  /** ISO timestamp of the last *accepted* hello; null = never connected. */
  lastSeenAt: string | null;
  /** Its protocol major differs from the hub's: listed, but not editable until
   *  its plugin is updated. */
  updateRequired?: boolean;
}

export interface ProjectSummary {
  pendingRename?: { operationId: string; targetId: string; status: "pending" };
  capabilities?: { canRename: boolean };
  id: string;
  name: string;
  slug?: string;
  hash: string;
  updatedAt?: string;
  serverKeyId: string | null;
  /** The project's disk id on the owning server — the one a module declares
   *  (`externalId`); it differs from `id` as soon as another server has already
   *  claimed the same name. */
  externalId?: string | null;
  /** Owning Add-on module id, as the plugin reported it with the project's root
   *  (`project_roots[].module_id`). Null for a folder or an add-on registered without
   *  its module — `ownerModuleOf` then falls back to the declared screens.
   *  Groups the project under "Installed modules" instead of the flat list. */
  ownerModule?: string | null;
}

/** The hub's servers, its own first: ids, labels, presence and versions. Rejects with an `ApiError`. */
export async function listServers(): Promise<ServerSummary[]> {
  return (await apiFetch<{ servers: ServerSummary[] }>("/api/v1/servers")).servers;
}

/** Creates a Project folder on a server's disk. Rejects with an `ApiError` carrying the hub's code. */
export async function createProject(serverId: string, name: string): Promise<ProjectSummary> {
  const path = `/api/v1/servers/${encodeURIComponent(serverId)}/projects`;
  return (await apiFetch<{ project: ProjectSummary }>(path, { method: "POST", json: { name } }))
    .project;
}
