import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index";
import { networkAccessRequests } from "../db/schema";
import { addMembership } from "./membershipManager";

export type AccessRequest = typeof networkAccessRequests.$inferSelect;

export async function createRequest(input: {
  networkId: string;
  userId: string;
  message?: string | null;
}): Promise<AccessRequest | { error: "already_pending" }> {
  const pending = await db
    .select({ id: networkAccessRequests.id })
    .from(networkAccessRequests)
    .where(
      and(
        eq(networkAccessRequests.networkId, input.networkId),
        eq(networkAccessRequests.userId, input.userId),
        eq(networkAccessRequests.status, "pending"),
      ),
    );
  if (pending.length > 0) return { error: "already_pending" };

  const id = "acr_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const now = new Date();
  await db.insert(networkAccessRequests).values({
    id,
    networkId: input.networkId,
    userId: input.userId,
    message: input.message ?? null,
    status: "pending",
    resolvedBy: null,
    createdAt: now,
    resolvedAt: null,
  });
  const rows = await db
    .select()
    .from(networkAccessRequests)
    .where(eq(networkAccessRequests.id, id));
  return rows[0]!;
}

export async function listRequests(networkId: string): Promise<AccessRequest[]> {
  return await db
    .select()
    .from(networkAccessRequests)
    .where(eq(networkAccessRequests.networkId, networkId))
    .orderBy(
      sql`(${networkAccessRequests.status} <> 'pending')`,
      desc(networkAccessRequests.createdAt),
    );
}

export async function resolveRequest(
  requestId: string,
  input: { approve: boolean; resolvedBy: string },
): Promise<AccessRequest | { error: "not_pending" }> {
  const rows = await db
    .select()
    .from(networkAccessRequests)
    .where(eq(networkAccessRequests.id, requestId));
  const request = rows[0];
  if (!request || request.status !== "pending") return { error: "not_pending" };

  if (input.approve) {
    try {
      await addMembership(request.userId, request.networkId, "member");
    } catch (err) {
      // Already a member (23505) is fine — still mark the request approved.
      // Any other error propagates: the request stays pending.
      const pgCode = (err as { code?: string })?.code;
      if (pgCode !== "23505") throw err;
    }
  }

  const now = new Date();
  const updated = await db
    .update(networkAccessRequests)
    .set({
      status: input.approve ? "approved" : "denied",
      resolvedBy: input.resolvedBy,
      resolvedAt: now,
    })
    .where(eq(networkAccessRequests.id, requestId))
    .returning();
  return updated[0]!;
}
