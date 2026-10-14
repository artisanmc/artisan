const API_URL = import.meta.env.VITE_API_URL ?? "";

export interface NetworkSummary {
  id: string;
  name: string;
  /** URL slug. Optional for resilience — callers fall back to `id` if absent. */
  slug?: string;
  tier: string;
}

export interface ServerKeySummary {
  id: string;
  label: string | null;
  slug?: string;
  /** A plugin is connected right now. Without it, its Projects are not listed —
   *  its disk holds them (ADR `server-disk-only-storage`). */
  online?: boolean;
}

export interface ProjectSummary {
  pendingRename?: { operationId: string; targetId: string; status: "pending" };
  capabilities?: { canRename: boolean };
  id: string;
  name: string;
  slug?: string;
  hash: string;
  updatedAt?: string;
  networkId: string;
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

/** The hub's single network, its servers (ids = server UUIDs). */
export async function getNetwork(): Promise<{
  network: NetworkSummary;
  projects: ProjectSummary[];
  serverKeys: ServerKeySummary[];
}> {
  const res = await fetch(`${API_URL}/api/v1/network`, { credentials: "include" });
  if (!res.ok) {
    // Attach the HTTP status so callers can react (e.g. 403/404 → redirect to
    // the user's own networks list rather than loop a broken page).
    const err = new Error(`getNetwork failed: ${res.status}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const json = (await res.json()) as {
    network: NetworkSummary;
    projects: ProjectSummary[];
    serverKeys: ServerKeySummary[];
  };
  return { network: json.network, projects: json.projects, serverKeys: json.serverKeys };
}

/** Content wire version the platform requires to write (ADR
 *  `content-version-negotiation`). 2 = keyed structured steps. */
export const MIN_CONTENT_VERSION = 2;

export interface ServerStatusEntry {
  id: string;
  label: string | null;
  online: boolean;
  lastMcVersion: string | null;
  /** ISO timestamp of the last *accepted* hello; null = never connected. */
  lastSeenAt: string | null;
  lastSeenIp: string | null;
  /** Content wire version read by the plugin (1 = legacy DSL, 2 = keyed). */
  contentVersion?: number;
  /** Connected plugin version (null = not seen since the hub started). */
  pluginVersion?: string | null;
  /** Newer version installable from the editor; null = nothing to offer. */
  pluginUpdateVersion?: string | null;
  /** Version already placed in `plugins/update/`, applied on the next restart. */
  pluginUpdatePending?: string | null;
  /** Editor served by the plugin: protocol major version differs from the hub's,
   *  the server cannot be edited until its plugin is updated. */
  updateRequired?: boolean;
  isCurrent: boolean;
}

/** A connected plugin that lags behind: it cannot read what the editor writes. */
export function isPluginOutdated(s: ServerStatusEntry): boolean {
  return s.online && (s.contentVersion ?? 1) < MIN_CONTENT_VERSION;
}

export interface NetworkServersStatus {
  servers: ServerStatusEntry[];
  online: number;
  total: number;
}

/** Topbar linked-servers aggregate: live online state + last-seen per server key. */
export async function getNetworkServersStatus(
  currentServerKeyId?: string,
): Promise<NetworkServersStatus> {
  const q = currentServerKeyId ? `?current=${encodeURIComponent(currentServerKeyId)}` : "";
  const res = await fetch(`${API_URL}/api/v1/network/servers-status${q}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`getNetworkServersStatus failed: ${res.status}`);
  return res.json();
}

export async function createProject(
  serverKeyId: string,
  name: string,
  description?: string,
): Promise<ProjectSummary> {
  const res = await fetch(`${API_URL}/api/v1/network/projects`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      serverKeyId,
      ...(description !== undefined && { description }),
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "create_failed");
  }
  return ((await res.json()) as { project: ProjectSummary }).project;
}
