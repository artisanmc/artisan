import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/index";
import { memberships, projects, serverKeys } from "../db/schema";
import type { Capability } from "./capabilities";
import { can } from "./capabilities";
import type { Role } from "./capabilities";

export type { Role };

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Runs `fn` inside a transaction holding a Postgres advisory lock scoped to
 * `networkId` (hashtext(networkId)) for the transaction's duration.
 *
 * Closes a TOCTOU window on the last-owner guard: without this, two
 * concurrent requests against the last two managers of a network could each
 * run `countManagers` (see it >= 2), both pass the guard, and both mutate —
 * leaving the network with zero managers. Serializing check+mutation behind
 * a per-network advisory lock (released automatically at transaction end)
 * makes the second request see the first request's write before deciding.
 */
export async function withNetworkMemberLock<T>(
  networkId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${networkId}))`);
    return fn(tx);
  });
}

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

/** Returns the caller's role in the network, or null if not a member. */
export async function getRole(userId: string, networkId: string): Promise<string | null> {
  const rows = await db.select().from(memberships).where(and(
    eq(memberships.userId, userId),
    eq(memberships.networkId, networkId),
  ));
  return rows[0]?.role ?? null;
}

export async function requireCapability(userId: string, networkId: string, cap: Capability): Promise<void> {
  const role = await getRole(userId, networkId);
  if (!role || !can(role, cap)) {
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
