import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { packs } from "../db/schema";

export async function computeBundleHash(files: Record<string, string>, packId: string): Promise<string> {
  const prefix = `plugins/Artisan/packs/${packId}/`;
  const sorted = Object.entries(files)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => ({ path: k.slice(prefix.length), content: v }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  if (sorted.length === 0) return "";

  const data = sorted.map((e) => `${e.path}\n${e.content}\n`).join("");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function computeAllPacksHash(serverId: string): Promise<string> {
  const boundPacks = await db.select().from(packs).where(
    and(eq(packs.serverKeyId, serverId), isNull(packs.deletedAt)),
  );

  if (boundPacks.length === 0) return "";

  const sorted = [...boundPacks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const data = sorted.map((p) => `${p.id}:${p.hash}\n`).join("");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
