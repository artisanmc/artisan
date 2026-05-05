import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { packBundles } from "../db/schema";

export async function computeBundleHash(files: Record<string, string>, packId: string): Promise<string> {
  const prefix = `plugins/Interfaze/packs/${packId}/`;
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
  const bundles = await db
    .select({ packId: packBundles.packId, hash: packBundles.hash })
    .from(packBundles)
    .where(eq(packBundles.serverId, serverId));

  if (bundles.length === 0) return "";

  const sorted = [...bundles].sort((a, b) => (a.packId < b.packId ? -1 : a.packId > b.packId ? 1 : 0));
  const data = sorted.map((b) => `${b.packId}:${b.hash}\n`).join("");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
