import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { billingConfigAudit, serverKeys } from "../../db/schema";
import { getSetting, setSetting } from "../../lib/appSettings";
import { requestProjectList } from "../../ws/hub";
import { getNetworkBilling } from "./networkBillingRepo";
import { countPersonalResources, hasProAccess, type ResourceEntry } from "./resourceQuota";
import { planLimits } from "./planLimits";

export const EDITOR_POLICY_KEY = "editor_commercial_policy";
export interface EditorCommercialPolicy {
  quota: number;
  enforcementEnabled: boolean;
}
const defaults: EditorCommercialPolicy = { quota: 10, enforcementEnabled: false };

export async function getEditorCommercialPolicy(): Promise<EditorCommercialPolicy> {
  const value = await getSetting<Partial<EditorCommercialPolicy>>(EDITOR_POLICY_KEY);
  return {
    quota: Number.isSafeInteger(value?.quota) && value!.quota! >= 0 ? value!.quota! : defaults.quota,
    enforcementEnabled: value?.enforcementEnabled === true,
  };
}

export async function updateEditorCommercialPolicy(next: EditorCommercialPolicy, actorId: string): Promise<void> {
  const before = await getEditorCommercialPolicy();
  await setSetting(EDITOR_POLICY_KEY, next, actorId);
  await db.insert(billingConfigAudit).values({ id: crypto.randomUUID(), actorId, action: "editor_policy_update", before, after: next, createdAt: new Date() });
}

export interface ServerCommercialPolicy {
  enabled: boolean;
  quota: number;
  proUntil: string | null;
}

export async function resolveServerCommercialPolicy(serverKeyId: string): Promise<ServerCommercialPolicy> {
  const policy = await getEditorCommercialPolicy();
  const server = (await db.select({ networkId: serverKeys.networkId }).from(serverKeys).where(eq(serverKeys.id, serverKeyId)))[0];
  if (!server) throw new Error("server_not_found");
  const billing = await getNetworkBilling(server.networkId);
  const pro = hasProAccess(billing);
  return { enabled: policy.enforcementEnabled, quota: policy.quota, proUntil: pro ? billing!.paidThrough!.toISOString() : null };
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
  const pro = !!policy.proUntil;
  const quota = pro ? planLimits.pro.resourcesPerServer : policy.quota;
  const reason = !policy.enabled ? null : count > quota ? "free_quota_exceeded" : count === quota ? "free_quota_reached" : null;
  return { ...policy, quota, inventoryAvailable: true as const, count, reason, resources };
}
