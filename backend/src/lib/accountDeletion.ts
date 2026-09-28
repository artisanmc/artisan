import { randomBytes, createHash } from "node:crypto";
import { and, eq, gt, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  accountDeletionTokens,
  deletedDraftOwners,
  aiUsageLog,
  appSettings,
  assistantConversations,
  memberships,
  networkAccessRequests,
  networkBilling,
  networkInvites,
  networks,
  networkTransfers,
  projectDraftOperations,
  projectDrafts,
  serverKeys,
  users,
} from "../db/schema";
import { can } from "./capabilities";
import { disconnectServerKey, disconnectUserEditors } from "../ws/hub";
import { revokeUserTickets } from "./wsTickets";

export const hashDeletionToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function requestAccountDeletion(userId: string, email: string) {
  const token = randomBytes(32).toString("base64url");
  const values = {
    userId,
    email,
    tokenHash: hashDeletionToken(token),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 60_000),
  };
  const rows = await db
    .insert(accountDeletionTokens)
    .values(values)
    .onConflictDoUpdate({
      target: accountDeletionTokens.userId,
      set: values,
      where: lte(accountDeletionTokens.createdAt, new Date(Date.now() - 60_000)),
    })
    .returning();
  if (!rows.length) throw new Error("rate_limited");
  return token;
}

export async function discardDeletionToken(token: string) {
  await db
    .delete(accountDeletionTokens)
    .where(eq(accountDeletionTokens.tokenHash, hashDeletionToken(token)));
}

export async function deleteAccount(token: string) {
  const result = await db.transaction(async (tx) => {
    const [confirmation] = await tx
      .delete(accountDeletionTokens)
      .where(
        and(
          eq(accountDeletionTokens.tokenHash, hashDeletionToken(token)),
          gt(accountDeletionTokens.expiresAt, new Date()),
        ),
      )
      .returning();
    if (!confirmation) return false;
    const userId = confirmation.userId;
    const [user] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, userId), eq(users.email, confirmation.email)));
    if (!user) return false;
    await tx.insert(deletedDraftOwners).values({ ownerId: userId, deletedAt: new Date() }).onConflictDoNothing();
    const memberOf = await tx.select().from(memberships).where(eq(memberships.userId, userId));
    const removedKeys: string[] = [];
    for (const { networkId } of memberOf.sort((a, b) => (a.networkId < b.networkId ? -1 : 1))) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${networkId}))`);
      const members = await tx
        .select()
        .from(memberships)
        .where(eq(memberships.networkId, networkId));
      const self = members.find((m) => m.userId === userId);
      const otherManager = members.some(
        (m) => m.userId !== userId && can(m.role, "manage_members"),
      );
      if (!self || (!can(self.role, "manage_members") && members.length > 1) || otherManager)
        continue;
      const [billing] = await tx
        .select()
        .from(networkBilling)
        .where(eq(networkBilling.networkId, networkId));
      if (billing?.stripeSubscriptionId && billing.status !== "canceled")
        throw new Error("active_subscription");
      removedKeys.push(
        ...(
          await tx
            .select({ id: serverKeys.id })
            .from(serverKeys)
            .where(eq(serverKeys.networkId, networkId))
        ).map((k) => k.id),
      );
      await tx.delete(networks).where(eq(networks.id, networkId));
    }
    await tx
      .delete(networkInvites)
      .where(or(eq(networkInvites.createdBy, userId), eq(networkInvites.email, user.email)));
    await tx
      .delete(networkTransfers)
      .where(
        or(
          eq(networkTransfers.initiatedByUserId, userId),
          eq(networkTransfers.consumedByUserId, userId),
        ),
      );
    await tx.update(appSettings).set({ updatedBy: null }).where(eq(appSettings.updatedBy, userId));
    await tx
      .update(networkAccessRequests)
      .set({ resolvedBy: null })
      .where(eq(networkAccessRequests.resolvedBy, userId));
    await tx
      .delete(assistantConversations)
      .where(eq(assistantConversations.ownerKey, `user:${userId}`));
    await tx
      .update(aiUsageLog)
      .set({ promptPreview: "", errorMessage: null, conversationId: null })
      .where(eq(aiUsageLog.userId, userId));
    // Pas de FK vers `users` (un invité de démo possède aussi des brouillons) :
    // les brouillons privés et leurs reçus partent explicitement.
    await tx.delete(projectDrafts).where(eq(projectDrafts.ownerId, userId));
    await tx.delete(projectDraftOperations).where(eq(projectDraftOperations.ownerId, userId));
    const deleted = await tx
      .delete(users)
      .where(and(eq(users.id, userId), eq(users.email, confirmation.email)))
      .returning({ id: users.id });
    if (!deleted.length) throw new Error("invalid_token");
    return { userId, removedKeys };
  });
  if (!result) return false;
  revokeUserTickets(result.userId);
  disconnectUserEditors(result.userId);
  for (const id of result.removedKeys) disconnectServerKey(id);
  return true;
}
