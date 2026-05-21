import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { memberships, packs } from "../db/schema";

export type Role = "owner" | "admin";

export async function isMember(userId: string, networkId: string, role?: Role): Promise<boolean> {
  const rows = await db.select().from(memberships).where(and(
    eq(memberships.userId, userId),
    eq(memberships.networkId, networkId),
  ));
  if (rows.length === 0) return false;
  if (role !== undefined && rows[0].role !== role) return false;
  return true;
}

export async function requireMember(userId: string, networkId: string, role?: Role): Promise<void> {
  if (!(await isMember(userId, networkId, role))) {
    const err = new Error("forbidden");
    (err as Error & { code?: string }).code = "forbidden";
    throw err;
  }
}

export async function getNetworkOfPack(packId: string): Promise<string | null> {
  const rows = await db.select({ networkId: packs.networkId }).from(packs).where(eq(packs.id, packId));
  return rows[0]?.networkId ?? null;
}
