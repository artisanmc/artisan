import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { serverKeys } from "../../db/schema";
import { requestProjectList } from "../../ws/hub";
import { resolveNetworkEntitlements } from "./entitlements";
import { countPersonalResources, type ResourceEntry } from "./resourceQuota";

export interface ServerCommercialPolicy {
  enabled: true;
  quota: number | null;
  proUntil: string | null;
}

export async function resolveServerCommercialPolicy(serverKeyId: string): Promise<ServerCommercialPolicy> {
  const server = (await db.select({ networkId: serverKeys.networkId }).from(serverKeys).where(eq(serverKeys.id, serverKeyId)))[0];
  if (!server) throw new Error("server_not_found");
  const rights = await resolveNetworkEntitlements(server.networkId);
  return { enabled: true, quota: rights.limits.resourcesPerServer, proUntil: null };
}

export async function getServerEditorAccess(serverKeyId: string) {
  const policy = await resolveServerCommercialPolicy(serverKeyId);
  const outcome = await requestProjectList(serverKeyId);
  const inventory = outcome.kind === "result" && outcome.result.ok ? outcome.result.resource_inventory : null;
  if (!Array.isArray(inventory) || !inventory.every((entry) => entry && typeof entry.project_id === "string" && typeof entry.path === "string" && (entry.origin === "personal" || entry.origin === "module"))) {
    return { ...policy, inventoryAvailable: false as const, count: null, reason: "inventory_unavailable" as const, resources: [] as ResourceEntry[] };
  }
  const resources: ResourceEntry[] = inventory.map((entry) => ({ projectId: entry.project_id, path: entry.path, origin: entry.origin }));
  const count = countPersonalResources(resources);
  const quota = policy.quota;
  const reason = quota === null ? null : count > quota ? "free_quota_exceeded" : count === quota ? "free_quota_reached" : null;
  return { ...policy, quota, inventoryAvailable: true as const, count, reason, resources };
}
