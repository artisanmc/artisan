import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { projects } from "../db/schema";

export async function computeBundleHash(files: Record<string, string>, projectId: string): Promise<string> {
  // TODO(phase4-wire): on-disk/manifest prefix literal `plugins/Artisan/packs/` —
  // flips to `projects/` in lockstep with the plugin (hash is prefix-stripped, so
  // the relPath-keyed map and expectedHash are unaffected by the rename itself).
  const prefix = `plugins/Artisan/packs/${projectId}/`;
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
  const boundProjects = await db.select().from(projects).where(
    and(eq(projects.serverKeyId, serverId), isNull(projects.deletedAt)),
  );

  if (boundProjects.length === 0) return "";

  const sorted = [...boundProjects].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const data = sorted.map((p) => `${p.id}:${p.hash}\n`).join("");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
