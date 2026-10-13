/**
 * Downloads the official Minecraft client JAR from Mojang and extracts
 * textures, models, item definitions and fonts into mc-assets/{version}/.
 * Results are persisted on disk; a `.done` marker prevents re-downloading.
 */

import { join, dirname } from "path";
import { existsSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
import { unzipSync } from "fflate";

const ROOT = join(import.meta.dir, "..");
const MOJANG_MANIFEST = "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json";

// Tracks in-flight downloads so concurrent calls for the same version
// coalesce into one fetch instead of downloading the JAR twice.
const downloading = new Map<string, Promise<void>>();

export function assetsRoot(version: string): string {
  return join(ROOT, "mc-assets", version);
}

export function assetsDone(version: string): boolean {
  return existsSync(join(assetsRoot(version), ".done"));
}

export function ensureAssets(version: string): Promise<void> {
  if (assetsDone(version)) return Promise.resolve();
  const existing = downloading.get(version);
  if (existing) return existing;
  const promise = _download(version).finally(() => downloading.delete(version));
  downloading.set(version, promise);
  return promise;
}

async function _download(version: string): Promise<void> {
  console.log(`[mc-assets] Downloading MC ${version} client JAR from Mojang…`);

  // 1. Version manifest → version URL
  const manifest = await fetch(MOJANG_MANIFEST).then((r) => r.json()) as {
    versions: Array<{ id: string; url: string }>;
  };
  const entry = manifest.versions.find((v) => v.id === version);
  if (!entry) {
    console.warn(`[mc-assets] Version ${version} not found in Mojang manifest — trying minor fallback`);
    const [major, minor] = version.split(".");
    const fallback = manifest.versions.find((v) => v.id.startsWith(`${major}.${minor}.`));
    if (!fallback) throw new Error(`MC version ${version} not found in Mojang manifest`);
    return _download(fallback.id);
  }

  // 2. Version JSON → client JAR URL + size
  const versionData = await fetch(entry.url).then((r) => r.json()) as {
    downloads: { client: { url: string; size: number } };
  };
  const { url: jarUrl, size: jarSize } = versionData.downloads.client;
  console.log(`[mc-assets] JAR size: ${(jarSize / 1024 / 1024).toFixed(1)} MB`);

  // 3. Download the JAR
  const jarRes = await fetch(jarUrl);
  if (!jarRes.ok) throw new Error(`Failed to fetch client JAR: ${jarRes.status}`);
  const jarBuf = new Uint8Array(await jarRes.arrayBuffer());

  // 4. Extract only the asset paths we need (textures, models, item definitions)
  console.log(`[mc-assets] Extracting assets from JAR…`);
  const WANT_PREFIXES = [
    "assets/minecraft/textures/",
    "assets/minecraft/models/",
    "assets/minecraft/items/",
    "assets/minecraft/font/",
  ];
  const jar = unzipSync(jarBuf, {
    filter: (file) => WANT_PREFIXES.some((p) => file.name.startsWith(p)),
  });

  // 5. Write files to disk, stripping the leading "assets/minecraft/" segment
  const root = assetsRoot(version);
  let count = 0;
  const writes: Promise<void>[] = [];
  for (const [zipPath, bytes] of Object.entries(jar)) {
    const localPath = join(root, zipPath.replace(/^assets\/minecraft\//, ""));
    writes.push(
      mkdir(dirname(localPath), { recursive: true }).then(() => writeFile(localPath, bytes)),
    );
    count++;
  }
  await Promise.all(writes);

  // 6. Done marker
  await writeFile(join(root, ".done"), version);
  console.log(`[mc-assets] Done — ${count} assets saved to ${root}`);
}
