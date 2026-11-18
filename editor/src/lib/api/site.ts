import { apiFetch } from "./client";

/**
 * The network's link to an account of the Artisan site, and what that account lets a server
 * install (ADR `site-account-and-module-updates`). The site token stays in the hub.
 */
export interface SiteLinkStatus {
  /** The site's address, as the hub's environment.yml gives it. */
  site: string;
  linked: boolean;
  /** The name the network gave when it was linked. */
  name: string | null;
  linkedAt: string | null;
  /** This session may link, unlink and install (`artisan.editor.config`). */
  canManage: boolean;
  /** A code waiting for the owner's approval on the site. */
  pending: { userCode: string; verificationUrl: string; expiresAt: string } | null;
}

export type UpdateChannel = "release" | "dev";

/** A jar on its way to, or waiting in, the server's plugins folder since it last started. */
export interface StagedModule {
  version: string;
  state: "downloading" | "ready" | "failed";
  error?: string;
}

export interface SiteModule {
  id: string;
  name: string;
  /** The Bukkit plugin's name. */
  plugin: string;
  tagline: { en: string; fr?: string } | null;
  /** In the currency's smallest unit; null: free. */
  price: { amount: number; currency: string } | null;
  /** Ids of the modules it needs. */
  requires: string[];
  /** Its versions page on the site. */
  page: string | null;
  /** The version the server runs, null when it does not run it. */
  installed: string | null;
  /**
   * `licence`: the account has not bought it. `supporter`: development builds of a free module,
   * for accounts with the site's Supporter plan (`page` is then the plan's page).
   */
  access: "ok" | "licence" | "supporter";
  latest: { version: string; changelog: string; size: number; published: string | null } | null;
  update: boolean;
  staged: StagedModule | null;
}

const LINK = "/api/v1/site/link";

export function getSiteLink(): Promise<SiteLinkStatus> {
  return apiFetch(LINK);
}

/** Asks the site for a code to approve; the answer carries it as `pending`. */
export function startSiteLink(): Promise<SiteLinkStatus> {
  return apiFetch(LINK, { method: "POST", json: {} });
}

export function removeSiteLink(): Promise<SiteLinkStatus> {
  return apiFetch(LINK, { method: "DELETE" });
}

/** A server's modules on one channel; `canRestart`: its plugin knows how to restart it. */
export interface SiteModuleList {
  modules: SiteModule[];
  canRestart: boolean;
}

export async function listSiteModules(
  serverId: string,
  channel: UpdateChannel,
): Promise<SiteModuleList> {
  const path = `/api/v1/servers/${encodeURIComponent(serverId)}/updates?channel=${channel}`;
  const { modules, canRestart } = await apiFetch<Partial<SiteModuleList>>(path);
  return { modules: modules ?? [], canRestart: canRestart === true };
}

/** Asks the server to restart; it tells its players and goes after that many seconds. */
export async function restartServer(serverId: string): Promise<number> {
  const path = `/api/v1/servers/${encodeURIComponent(serverId)}/updates/restart`;
  return (await apiFetch<{ seconds?: number }>(path, { method: "POST", json: {} })).seconds ?? 0;
}

/** Starts the download on the server; its progress is the module's `staged`. */
export async function installSiteModule(
  serverId: string,
  module: string,
  channel: UpdateChannel,
): Promise<void> {
  await apiFetch(`/api/v1/servers/${encodeURIComponent(serverId)}/updates/install`, {
    method: "POST",
    json: { module, channel },
  });
}
