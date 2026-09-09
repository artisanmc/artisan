import { expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../db/index";
import { discordAccounts, users } from "../db/schema";
import { resolveOauthAccount, type OauthIdentity } from "./oauthAccounts";

test("Google and Discord first logins with the same verified email share one Artisan account", async () => {
  const email = `${crypto.randomUUID()}@gmail.com`;
  const identity: OauthIdentity = {
    provider: "google", subject: crypto.randomUUID(), email, emailVerified: true,
    canLinkByEmail: true, name: "Original", avatarUrl: null,
  };
  const accounts = await Promise.all([
    resolveOauthAccount(identity),
    resolveOauthAccount({ ...identity, provider: "discord", subject: crypto.randomUUID() }),
  ]);
  try {
    expect(accounts[0].userId).toBe(accounts[1].userId);
    expect(accounts.filter((account) => account.created)).toHaveLength(1);
  } finally { await db.delete(users).where(eq(users.email, email)); }
});

test("migration preserves a legacy Discord link even when its current email differs", async () => {
  const userId = `user_${crypto.randomUUID()}`;
  const subject = crypto.randomUUID();
  const now = new Date();
  await db.insert(users).values({ id: userId, email: `${userId}@gmail.com`, name: "Legacy", createdAt: now, updatedAt: now });
  try {
    await db.insert(discordAccounts).values({ discordUserId: subject, userId, username: "Legacy", email: "old@example.com", linkedAt: now });
    const migration = await Bun.file(new URL("../../drizzle/0034_brown_famine.sql", import.meta.url)).text();
    const backfill = migration.split("--> statement-breakpoint").find((statement) => statement.includes('INSERT INTO "oauth_accounts"'));
    expect(backfill).toBeDefined();
    await db.execute(sql.raw(backfill!));
    const account = await resolveOauthAccount({
      provider: "discord", subject, email: "changed@example.com", emailVerified: false,
      canLinkByEmail: false, name: "Renamed", avatarUrl: null,
    });
    expect(account).toEqual({ userId, created: false });
  } finally { await db.delete(users).where(eq(users.id, userId)); }
});
