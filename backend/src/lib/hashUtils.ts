import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/index";
import { projects } from "../db/schema";
import { projectDiskId } from "./projectStorage";

/** relPaths whose first segment starts with `.artisan` are sync/editor
 *  metadata — excluded from the hash (mirrored in the plugin's
 *  ProjectFilesReader/BundleHasher; locked by project-hash-conformance.json). */
function isArtisanMeta(relPath: string): boolean {
  return relPath.split("/", 1)[0]!.startsWith(".artisan");
}

/** [diskId] : id DISQUE du project — le préfixe réel des clés de `files`. */
export async function computeBundleHash(files: Record<string, string>, diskId: string): Promise<string> {
  const prefix = `plugins/Artisan/projects/${diskId}/`;
  const sorted = Object.entries(files)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => ({ path: k.slice(prefix.length), content: v }))
    .filter((e) => !isArtisanMeta(e.path))
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

  // Keyed by the DISK id: this hash is compared against the plugin's
  // current_bundle_hash, which the plugin builds from its own directory names.
  // Using the internal id would make needs_sync permanently true for a project
  // whose disk id was already claimed by another server.
  const withDiskIds = boundProjects.map((p) => ({ diskId: projectDiskId(p), hash: p.hash }));
  const sorted = withDiskIds.sort((a, b) => (a.diskId < b.diskId ? -1 : a.diskId > b.diskId ? 1 : 0));
  const data = sorted.map((p) => `${p.diskId}:${p.hash}\n`).join("");
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}
