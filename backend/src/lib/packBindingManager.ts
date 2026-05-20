import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { packBindings, packs } from "../db/schema";

export async function createBinding(serverKeyId: string, packId: string): Promise<void> {
  const id = "bind_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  await db.insert(packBindings).values({ id, serverKeyId, packId, createdAt: new Date() });
}

export async function deleteBinding(serverKeyId: string, packId: string): Promise<void> {
  await db.delete(packBindings)
    .where(and(eq(packBindings.serverKeyId, serverKeyId), eq(packBindings.packId, packId)));
}

export async function listPacksForServerKey(serverKeyId: string) {
  const bindings = await db.select({ packId: packBindings.packId })
    .from(packBindings).where(eq(packBindings.serverKeyId, serverKeyId));
  if (bindings.length === 0) return [];
  return await db.select().from(packs).where(and(
    inArray(packs.id, bindings.map((b) => b.packId)),
    isNull(packs.deletedAt),
  ));
}

export async function listServerKeysForPack(packId: string): Promise<string[]> {
  const rows = await db.select({ serverKeyId: packBindings.serverKeyId })
    .from(packBindings).where(eq(packBindings.packId, packId));
  return rows.map((r) => r.serverKeyId);
}
