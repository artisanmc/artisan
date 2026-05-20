import { eq, inArray } from "drizzle-orm";
import { db } from "../db/index";
import { memberships, networks } from "../db/schema";

export type Role = "owner" | "admin";

export async function addMembership(userId: string, networkId: string, role: Role): Promise<void> {
  const id = "mem_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await db.insert(memberships).values({ id, userId, networkId, role, createdAt: new Date() });
}

export async function listNetworksForUser(userId: string) {
  const memb = await db.select({ networkId: memberships.networkId }).from(memberships).where(eq(memberships.userId, userId));
  if (memb.length === 0) return [];
  return await db.select().from(networks).where(inArray(networks.id, memb.map((m) => m.networkId)));
}
