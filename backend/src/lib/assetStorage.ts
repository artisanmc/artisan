import { mkdir, writeFile, unlink } from "fs/promises";
import { join, resolve } from "path";

export function assetRoot(): string {
  return resolve("data/assets");
}

export function assetPath(serverKeyId: string, assetId: string): string {
  return join(assetRoot(), serverKeyId, `${assetId}.png`);
}

export async function writeAssetFile(serverKeyId: string, assetId: string, data: Uint8Array): Promise<void> {
  const dir = join(assetRoot(), serverKeyId);
  await mkdir(dir, { recursive: true });
  await writeFile(assetPath(serverKeyId, assetId), data);
}

export async function deleteAssetFile(serverKeyId: string, assetId: string): Promise<void> {
  try {
    await unlink(assetPath(serverKeyId, assetId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
