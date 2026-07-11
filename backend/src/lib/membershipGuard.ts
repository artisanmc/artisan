import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/index";
import { memberships, projects, serverKeys } from "../db/schema";

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

export async function getNetworkOfProject(projectId: string): Promise<string | null> {
  const rows = await db.select({ networkId: projects.networkId }).from(projects).where(eq(projects.id, projectId));
  return rows[0]?.networkId ?? null;
}

/**
 * All serverKeyIds reachable by a user: memberships → networks → server_keys.
 * Used to subscribe a ticket-authenticated editor WS conn to the full set of
 * servers the user can see, instead of a single serverKeyId (session path).
 */
export async function listServerKeyIdsForUser(userId: string): Promise<string[]> {
  const memberRows = await db.select({ networkId: memberships.networkId }).from(memberships).where(eq(memberships.userId, userId));
  const networkIds = memberRows.map((r) => r.networkId);
  if (networkIds.length === 0) return [];
  const keyRows = await db.select({ id: serverKeys.id }).from(serverKeys).where(inArray(serverKeys.networkId, networkIds));
  return keyRows.map((r) => r.id);
}
