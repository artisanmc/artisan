import { join, dirname } from "path";
import { existsSync } from "fs";
import { mkdir, writeFile, readFile } from "fs/promises";
import { gunzipSync, unzipSync } from "fflate";

export interface CustomItemEntry {
  id: string;
  label: string;
  category: string;
  texture: string;
}

export function customItemsCacheDir(serverKeyId: string): string {
  const DATA_DIR = join(import.meta.dir, "../../data");
  return join(DATA_DIR, "custom-items", serverKeyId);
}

export async function readCustomItemsHash(cacheDir: string): Promise<string> {
  try {
    return (await readFile(join(cacheDir, "hash.txt"), "utf-8")).trim();
  } catch {
    return "";
  }
}

export async function readCustomItems(cacheDir: string): Promise<CustomItemEntry[]> {
  try {
    const raw = await readFile(join(cacheDir, "items.json"), "utf-8");
    return JSON.parse(raw) as CustomItemEntry[];
  } catch {
    return [];
  }
}

export async function processBundle(cacheDir: string, hash: string, data: string): Promise<void> {
  const gzipped = Buffer.from(data, "base64");
  const zipped = gunzipSync(gzipped);
  const files = unzipSync(zipped);

  const writes: Promise<void>[] = [];
  for (const [path, bytes] of Object.entries(files)) {
    if (path !== "items.json" && !path.startsWith("textures/")) continue;
    const fullPath = join(cacheDir, path);
    writes.push(
      mkdir(dirname(fullPath), { recursive: true }).then(() => writeFile(fullPath, bytes)),
    );
  }
  await Promise.all(writes);
  await writeFile(join(cacheDir, "hash.txt"), hash);
}
