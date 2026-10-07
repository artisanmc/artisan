import { join, dirname, resolve, relative } from "path";
import { existsSync } from "fs";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { gunzipSync, unzipSync } from "fflate";

export interface CustomItemEntry {
  id: string;
  label: string;
  category: string;
}

export const SERVER_KEY_ID_PATTERN = "[A-Za-z0-9_-]+";

export function customItemsCacheDir(serverKeyId: string): string {
  if (!new RegExp(`^${SERVER_KEY_ID_PATTERN}$`).test(serverKeyId)) throw new Error(`invalid server key id: ${serverKeyId}`);
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

  let hasTextures = false;
  let hasModels = false;
  const writes: Promise<void>[] = [];
  for (const [path, bytes] of Object.entries(files)) {
    if (path !== "items.json" && !path.startsWith("textures/") && !path.startsWith("models/")) continue;
    if (path.startsWith("textures/")) hasTextures = true;
    if (path.startsWith("models/")) hasModels = true;
    const fullPath = join(cacheDir, path);
    if (relative(resolve(cacheDir), resolve(fullPath)).startsWith("..")) continue;
    writes.push(
      mkdir(dirname(fullPath), { recursive: true }).then(() => writeFile(fullPath, bytes)),
    );
  }
  await Promise.all(writes);

  // Migration cleanup: a new-schema bundle carries items.json only. Wipe any
  // textures/models left from a previous full-schema bundle so 404 responses
  // are consistent with what the plugin reports.
  if (!hasTextures && existsSync(join(cacheDir, "textures"))) {
    await rm(join(cacheDir, "textures"), { recursive: true, force: true });
  }
  if (!hasModels && existsSync(join(cacheDir, "models"))) {
    await rm(join(cacheDir, "models"), { recursive: true, force: true });
  }

  await writeFile(join(cacheDir, "hash.txt"), hash);
}
