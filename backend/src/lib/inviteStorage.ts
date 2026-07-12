import { and, desc, eq, gt, isNull, or, sql } from "drizzle-orm";
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

/**
 * Atomically consumes one use of an invite: increments usedCount only if the
 * invite is still valid at the DB level (not revoked, not expired, under
 * maxUses). Returns the updated row, or null if no row matched (someone else
 * won the race, or it became invalid between the caller's own checks and this
 * call). This closes the TOCTOU window a plain SELECT-then-UPDATE would leave
 * open under concurrent accepts of a maxUses-limited invite.
 */
export async function consumeInvite(inviteId: string, now: Date = new Date()): Promise<Invite | null> {
  const rows = await db
    .update(networkInvites)
    .set({ usedCount: sql`${networkInvites.usedCount} + 1` })
    .where(and(
      eq(networkInvites.id, inviteId),
      isNull(networkInvites.revokedAt),
      gt(networkInvites.expiresAt, now),
      or(isNull(networkInvites.maxUses), sql`${networkInvites.usedCount} < ${networkInvites.maxUses}`),
    ))
    .returning();
  return rows[0] ?? null;
}

async function refundInvite(inviteId: string): Promise<void> {
  await db
    .update(networkInvites)
    .set({ usedCount: sql`greatest(${networkInvites.usedCount} - 1, 0)` })
    .where(eq(networkInvites.id, inviteId));
}

export async function acceptInvite(
  code: string,
  userId: string,
): Promise<{ networkId: string; alreadyMember: boolean } | { error: InviteStatus | "not_found" }> {
  const invite = await getInviteByCode(code);
  if (!invite) return { error: "not_found" };

  // Check membership BEFORE consuming a use — an already-a-member accept must
  // not burn a limited use (pinned by the "does NOT consume a use" test).
  // This fast-path intentionally bypasses the invite status check below —
  // an existing member re-accepting a revoked/expired invite still succeeds
  // idempotently instead of erroring, since they're already in the network.
  const existing = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.networkId, invite.networkId)));
  if (existing.length > 0) {
    return { networkId: invite.networkId, alreadyMember: true };
  }

  // Fast-path reject on the state we already have, for a precise error
  // message on the common (non-racy) case.
  const status = inviteStatus(invite);
  if (status !== "valid") return { error: status };

  // Atomic consume — re-validates at the DB level so a concurrent accept
  // against a maxUses-limited invite can't push usedCount past the limit.
  // No row back = another request consumed the last use (or revoked/expired
  // it) between our check above and this call.
  const consumed = await consumeInvite(invite.id);
  if (!consumed) {
    const fresh = await getInviteByCode(code);
    return { error: fresh ? inviteStatus(fresh) : "not_found" };
  }

  try {
    await addMembership(userId, invite.networkId, invite.role as Role);
  } catch (err) {
    // Any addMembership failure after a successful consumeInvite must refund
    // the use — otherwise a lost use sits with no membership to show for it.
    //
    // Race (common case): a concurrent request created the same
    // (userId, networkId) membership between our pre-check above and this
    // insert (unique constraint memberships_user_network_uniq, Postgres code
    // 23505). Refund and report alreadyMember instead of erroring.
    //
    // Any other failure (DB hiccup, unexpected error): still refund — the
    // membership was NOT created, so the use must not be considered spent —
    // then rethrow so the caller sees the real error.
    //
    // NOTE: not covered by a dedicated storage test — addMembership isn't
    // injectable/mockable here without a refactor of this module for
    // testability, which is out of scope for this fix. The 23505 branch
    // remains covered by the existing race test.
    await refundInvite(invite.id);
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === "23505") {
      return { networkId: invite.networkId, alreadyMember: true };
    }
    throw err;
  }
  return { networkId: invite.networkId, alreadyMember: false };
}

// NOTE (prod-readiness backlog): POST /accept has no rate limiting. Invite
// codes are 40-bit random over a 7-day default window (generateCode()) — not
// brute-forceable in isolation, but combined with no throttling this is a
// standing gap. See docs/superpowers backlog (project_prod_readiness_audit).

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
