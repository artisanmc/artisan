import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index";
import { networkInvites, memberships } from "../db/schema";
import { generateCode } from "./auth";
import { addMembership } from "./membershipManager";
import type { Role } from "./capabilities";

export type Invite = typeof networkInvites.$inferSelect;
export type InviteStatus = "valid" | "revoked" | "expired" | "exhausted";

const DEFAULT_EXPIRES_IN_DAYS = 7;

export async function createInvite(input: {
  networkId: string;
  createdBy: string;
  role?: Role;
  email?: string | null;
  maxUses?: number | null;
  expiresInDays?: number;
}): Promise<Invite> {
  const id = "inv_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const now = new Date();
  const expiresInDays = input.expiresInDays ?? DEFAULT_EXPIRES_IN_DAYS;
  const expiresAt = new Date(now.getTime() + expiresInDays * 24 * 60 * 60 * 1000);
  await db.insert(networkInvites).values({
    id,
    networkId: input.networkId,
    role: input.role ?? "member",
    code: generateCode(),
    email: input.email ?? null,
    maxUses: input.maxUses ?? null,
    usedCount: 0,
    expiresAt,
    revokedAt: null,
    createdBy: input.createdBy,
    createdAt: now,
  });
  const rows = await db.select().from(networkInvites).where(eq(networkInvites.id, id));
  return rows[0]!;
}

export async function getInviteByCode(code: string): Promise<Invite | null> {
  const rows = await db.select().from(networkInvites).where(eq(networkInvites.code, code));
  return rows[0] ?? null;
}

export function inviteStatus(invite: Invite, now: Date = new Date()): InviteStatus {
  if (invite.revokedAt) return "revoked";
  if (invite.expiresAt.getTime() < now.getTime()) return "expired";
  if (invite.maxUses != null && invite.usedCount >= invite.maxUses) return "exhausted";
  return "valid";
}

export async function acceptInvite(
  code: string,
  userId: string,
): Promise<{ networkId: string; alreadyMember: boolean } | { error: InviteStatus | "not_found" }> {
  const invite = await getInviteByCode(code);
  if (!invite) return { error: "not_found" };
  const status = inviteStatus(invite);
  if (status !== "valid") return { error: status };

  const existing = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.networkId, invite.networkId)));
  if (existing.length > 0) {
    return { networkId: invite.networkId, alreadyMember: true };
  }

  await addMembership(userId, invite.networkId, invite.role as Role);
  await db
    .update(networkInvites)
    .set({ usedCount: sql`${networkInvites.usedCount} + 1` })
    .where(eq(networkInvites.id, invite.id));
  return { networkId: invite.networkId, alreadyMember: false };
}

export async function revokeInvite(inviteId: string): Promise<void> {
  await db.update(networkInvites).set({ revokedAt: new Date() }).where(eq(networkInvites.id, inviteId));
}

export async function listInvites(networkId: string): Promise<Invite[]> {
  return await db
    .select()
    .from(networkInvites)
    .where(eq(networkInvites.networkId, networkId))
    .orderBy(sql`(${networkInvites.revokedAt} is not null)`, desc(networkInvites.createdAt));
}
