import { mkdir, readdir, stat, unlink, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve } from "path";

export function resourcePackRoot(): string {
  return resolve("data/resource-packs");
}

export function resourcePackPath(serverKeyId: string, hash: string): string {
  return join(resourcePackRoot(), serverKeyId, `${hash}.zip`);
}

export async function writeResourcePack(
  serverKeyId: string,
  hash: string,
  bytes: Uint8Array,
): Promise<void> {
  const dir = join(resourcePackRoot(), serverKeyId);
  await mkdir(dir, { recursive: true });
  await writeFile(resourcePackPath(serverKeyId, hash), bytes);
}

export async function listResourcePackHashes(serverKeyId: string): Promise<string[]> {
  const dir = join(resourcePackRoot(), serverKeyId);
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  const zips = files.filter((f) => f.endsWith(".zip"));
  const withStats = await Promise.all(
    zips.map(async (f) => ({ hash: f.replace(/\.zip$/, ""), mtime: (await stat(join(dir, f))).mtimeMs })),
  );
  withStats.sort((a, b) => b.mtime - a.mtime);
  return withStats.map((x) => x.hash);
}

export async function pruneOldResourcePacks(
  serverKeyId: string,
  keepCount: number,
  protectedHash?: string,
): Promise<void> {
  const all = await listResourcePackHashes(serverKeyId);
  const keep = new Set(all.slice(0, keepCount));
  if (protectedHash) keep.add(protectedHash);
  for (const hash of all) {
    if (keep.has(hash)) continue;
    try {
      await unlink(resourcePackPath(serverKeyId, hash));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
