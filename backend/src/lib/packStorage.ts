import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { packs } from "../db/schema";
import { createCommit } from "./commitStorage";
import { createBranch } from "./branchStorage";

export type Pack = typeof packs.$inferSelect;

/**
 * Initial editor JSON shape for a freshly created pack. Mirrors the editor's
 * `Pack` TypeScript type — every collection field is empty so the editor can
 * render an empty workspace without crashing. Without this default, the
 * editor used to get `editor: null` from GET /api/v1/user/packs/:packId and
 * render a black screen.
 */
function defaultEditorJson(id: string, name: string, now: Date): string {
  const iso = now.toISOString();
  return JSON.stringify({
    id,
    name,
    source: "user_created",
    createdAt: iso,
    updatedAt: iso,
    menus: [],
    commands: [],
    templates: [],
    assets: [],
    dataSources: [],
    importedConnectors: [],
    i18nKeys: {},
    defaultLang: "en",
    dialogs: [],
    canvasLayout: {},
  });
}

export async function createPack(input: {
  networkId: string;
  serverKeyId: string;  // required: the server_key that owns this pack
  name: string;
  description?: string | null;
  id?: string;          // optional, default generated
}): Promise<Pack> {
  const id = input.id ?? "pack_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const now = new Date();
  const initialEditor = defaultEditorJson(id, input.name, now);
  await db.insert(packs).values({
    id,
    networkId: input.networkId,
    serverKeyId: input.serverKeyId,
    name: input.name,
    description: input.description ?? null,
    hash: "",
    filesJson: "{}",
    editorJson: initialEditor,
    deployedEditorJson: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  // Phase 2: auto-create main branch with an initial empty commit carrying
  // the same default editor shape, so any plugin downloading the bundle gets
  // valid JSON instead of null.
  const root = await createCommit({
    packId: id,
    parentId: null,
    files: {},
    editor: JSON.parse(initialEditor),
    authorUserId: null,
    message: "Initial commit",
  });
  await createBranch(id, "main", root.id);
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
