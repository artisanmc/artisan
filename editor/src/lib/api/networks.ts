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
  /** Un plugin est branché en ce moment. Sans lui, ses Projects ne se listent
   *  pas — c'est son disque qui les porte (ADR `server-disk-only-storage`). */
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
  /** Id disque du project côté serveur propriétaire — c'est celui qu'un module
   *  déclare (`externalId`), et il diffère de `id` dès qu'un autre serveur a déjà
   *  réclamé le même nom. */
  externalId?: string | null;
  /** Owning Add-on module id, as the plugin reported it with the project's root
   *  (`project_roots[].module_id`). Null for a folder or an add-on registered without
   *  its module — `ownerModuleOf` then falls back to the declared screens.
   *  Groupe le project sous "Modules installés" au lieu de la liste plate. */
  ownerModule?: string | null;
}

export async function listNetworks(): Promise<NetworkSummary[]> {
  const res = await fetch(`${API_URL}/api/v1/networks`, { credentials: "include" });
  if (!res.ok) throw new Error(`listNetworks failed: ${res.status}`);
  return ((await res.json()) as { networks: NetworkSummary[] }).networks;
}

export async function getNetwork(id: string): Promise<{
  network: NetworkSummary;
  projects: ProjectSummary[];
  serverKeys: ServerKeySummary[];
}> {
  const res = await fetch(`${API_URL}/api/v1/networks/${id}`, { credentials: "include" });
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

/** Version du wire de contenu que la plateforme exige pour écrire (ADR
 *  `content-version-negotiation`). 2 = étapes structurées keyed. */
export const MIN_CONTENT_VERSION = 2;

export interface ServerStatusEntry {
  id: string;
  label: string | null;
  online: boolean;
  lastMcVersion: string | null;
  /** ISO timestamp of the last *accepted* hello; null = never connected. */
  lastSeenAt: string | null;
  lastSeenIp: string | null;
  /** Version du wire de contenu lue par le plugin (1 = DSL legacy, 2 = keyed). */
  contentVersion?: number;
  /** Version du plugin connecté (null = jamais vu depuis le démarrage du backend). */
  pluginVersion?: string | null;
  /** Version plus récente installable depuis l'éditeur ; null = rien à proposer. */
  pluginUpdateVersion?: string | null;
  /** Version déjà posée dans `plugins/update/`, appliquée au prochain redémarrage. */
  pluginUpdatePending?: string | null;
  /** Éditeur servi par le plugin : version majeure du protocole différente du hub,
   *  le serveur ne peut pas être édité tant que son plugin n'est pas à jour. */
  updateRequired?: boolean;
  isCurrent: boolean;
}

/** Un plugin connecté en retard : il ne sait pas lire ce que l'éditeur écrit. */
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
  networkId: string,
  currentServerKeyId?: string,
): Promise<NetworkServersStatus> {
  const q = currentServerKeyId ? `?current=${encodeURIComponent(currentServerKeyId)}` : "";
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/servers-status${q}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`getNetworkServersStatus failed: ${res.status}`);
  return res.json();
}

export async function createProject(
  networkId: string,
  serverKeyId: string,
  name: string,
  description?: string,
): Promise<ProjectSummary> {
  const res = await fetch(`${API_URL}/api/v1/networks/${networkId}/projects`, {
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

