import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/index";
import { oauthAccounts, users } from "../db/schema";
import { normalizeEmail } from "./emailNormalizer";

export interface OauthIdentity {
  provider: "google" | "discord";
  subject: string;
  email: string | null;
  emailVerified: boolean;
  canLinkByEmail: boolean;
  name: string;
  avatarUrl: string | null;
}

export class OauthAccountError extends Error {}

export async function resolveOauthAccount(identity: OauthIdentity) {
  return db.transaction(async (tx) => {
    // Serialize callbacks for the same identity, then for the same email.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`oauth:${identity.provider}:${identity.subject}`}, 0))`);
    const [link] = await tx.select().from(oauthAccounts).where(and(
      eq(oauthAccounts.provider, identity.provider), eq(oauthAccounts.subject, identity.subject),
    ));
    if (link) return { userId: link.userId, created: false };
    if (!identity.email || !identity.emailVerified) throw new OauthAccountError("oauth_email_unverified");
    const email = normalizeEmail(identity.email);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`oauth-email:${email}`}, 0))`);
    let [user] = await tx.select().from(users).where(eq(users.email, email));
    if (user && !identity.canLinkByEmail) throw new OauthAccountError("oauth_email_not_authoritative");
    let created = false;
    if (!user) {
      const now = new Date();
      const inserted = await tx.insert(users).values({
        id: `user_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
        email, name: identity.name, avatarUrl: identity.avatarUrl,
        passwordHash: null, createdAt: now, updatedAt: now,
      }).onConflictDoNothing({ target: users.email }).returning();
      created = inserted.length > 0;
      [user] = created ? inserted : await tx.select().from(users).where(eq(users.email, email));
      if (!created && !identity.canLinkByEmail) throw new OauthAccountError("oauth_email_not_authoritative");
    }
    const [other] = await tx.select().from(oauthAccounts).where(and(
      eq(oauthAccounts.provider, identity.provider), eq(oauthAccounts.userId, user.id),
    ));
    if (other) throw new OauthAccountError("oauth_account_already_linked");
    await tx.insert(oauthAccounts).values({
      provider: identity.provider, subject: identity.subject, userId: user.id,
      email, name: identity.name, linkedAt: new Date(),
    });
    return { userId: user.id, created };
  });
}
