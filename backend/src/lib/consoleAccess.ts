import { eq } from "drizzle-orm";
import { db } from "../db";
import { memberships, serverKeys, users } from "../db/schema";
import { withNetworkMemberLock } from "./membershipGuard";
import { resolveNetworkEntitlements } from "../modules/billing/entitlements";
import { collaboratorCount, withinPlanLimit } from "../modules/billing/planLimits";

export async function addConsoleMember(serverId: string, email: unknown, stillConnected: () => boolean) {
  if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "invalid_email" };
  }
  const [server] = await db.select().from(serverKeys).where(eq(serverKeys.id, serverId));
  if (!server) return { ok: false, error: "unauthorized" };
  return withNetworkMemberLock(server.networkId, async (tx) => {
    const [current] = await tx.select().from(serverKeys).where(eq(serverKeys.id, serverId)).for("update");
    if (!current || current.networkId !== server.networkId || !stillConnected()) return { ok: false, error: "unauthorized" };
    if (current.editorAccessMode !== "console") return { ok: false, error: "console_disabled" };
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email.toLowerCase()));
    if (!user) return { ok: false, error: "account_not_found" };
    const existing = await tx.select({ userId: memberships.userId, role: memberships.role }).from(memberships).where(eq(memberships.networkId, current.networkId));
    if (existing.some((entry) => entry.userId === user.id)) return { ok: true, already_member: true };
    const rights = await resolveNetworkEntitlements(current.networkId, tx);
    if (!withinPlanLimit(collaboratorCount(existing.map((entry) => entry.role)), rights.limits.collaborators)) return { ok: false, error: "collaborator_limit_reached" };
    const inserted = await tx.insert(memberships).values({
      id: `mem_${crypto.randomUUID()}`, networkId: current.networkId, userId: user.id,
      role: "member", createdAt: new Date(),
    }).onConflictDoNothing({ target: [memberships.userId, memberships.networkId] }).returning({ id: memberships.id });
    return { ok: true, already_member: inserted.length === 0 };
  });
}
