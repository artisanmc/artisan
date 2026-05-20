import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { packs } from "../db/schema";

export type Pack = typeof packs.$inferSelect;

export async function createPack(input: {
  networkId: string;
  name: string;
  description?: string | null;
  id?: string;          // optional, default generated
}): Promise<Pack> {
  const id = input.id ?? "pack_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const now = new Date();
  await db.insert(packs).values({
    id,
    networkId: input.networkId,
    name: input.name,
    description: input.description ?? null,
    hash: "",
    filesJson: "{}",
    editorJson: null,
    deployedEditorJson: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  return (await getPack(id))!;
}

export async function getPack(id: string): Promise<Pack | null> {
  const rows = await db.select().from(packs).where(eq(packs.id, id));
  return rows[0] ?? null;
}

export async function upsertPackContent(
  id: string,
  patch: { hash?: string; filesJson?: string; editorJson?: string | null; deployedEditorJson?: string | null },
): Promise<void> {
  await db.update(packs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(packs.id, id));
}

export async function softDeletePack(id: string): Promise<void> {
  await db.update(packs).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(packs.id, id));
}

export async function listPacksForNetwork(networkId: string): Promise<Pack[]> {
  return await db.select().from(packs).where(and(eq(packs.networkId, networkId), isNull(packs.deletedAt)));
}
