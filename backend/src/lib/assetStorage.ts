import { mkdir, writeFile, unlink } from "fs/promises";
import { join, resolve } from "path";

export function assetRoot(): string {
  return resolve("data/assets");
}

export function assetPath(packId: string, assetId: string): string {
  return join(assetRoot(), packId, `${assetId}.png`);
}

export async function writeAssetFile(packId: string, assetId: string, data: Uint8Array): Promise<void> {
  const dir = join(assetRoot(), packId);
  await mkdir(dir, { recursive: true });
  await writeFile(assetPath(packId, assetId), data);
}

export async function deleteAssetFile(packId: string, assetId: string): Promise<void> {
  try {
    await unlink(assetPath(packId, assetId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
