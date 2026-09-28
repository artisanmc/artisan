import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index";
import { memberships, networks } from "../db/schema";
import { withNetworkMemberLock } from "./membershipGuard";
import { resolveNetworkEntitlements } from "../modules/billing/entitlements";
import { collaboratorCount, PlanLimitError, withinPlanLimit } from "../modules/billing/planLimits";
import type { Role } from "./capabilities";

export type { Role };

export async function addMembership(userId: string, networkId: string, role: Role): Promise<void> {
  const id = "mem_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await withNetworkMemberLock(networkId, async (tx) => {
    const rights = await resolveNetworkEntitlements(networkId, tx);
    const existing = await tx.select({ role: memberships.role }).from(memberships).where(eq(memberships.networkId, networkId));
    const firstOwner = role === "owner" && !existing.some(entry => entry.role === "owner");
    if (!firstOwner && !withinPlanLimit(collaboratorCount(existing.map((entry) => entry.role)), rights.limits.collaborators)) throw new PlanLimitError("collaborator_limit_reached");
    await tx.insert(memberships).values({ id, userId, networkId, role, createdAt: new Date() });
  });
}

export async function listNetworksForUser(userId: string) {
  const memb = await db.select({ networkId: memberships.networkId }).from(memberships).where(eq(memberships.userId, userId));
  if (memb.length === 0) return [];
  return await db.select().from(networks).where(inArray(networks.id, memb.map((m) => m.networkId)));
}
