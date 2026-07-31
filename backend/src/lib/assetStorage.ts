import { mkdir, writeFile, unlink } from "fs/promises";
import { join, resolve } from "path";

export function assetRoot(): string {
  return resolve("data/assets");
}

export function assetPath(projectId: string, assetId: string): string {
  return join(assetRoot(), projectId, `${assetId}.png`);
}

export async function writeAssetFile(projectId: string, assetId: string, data: Uint8Array): Promise<void> {
  const dir = join(assetRoot(), projectId);
  await mkdir(dir, { recursive: true });
  await writeFile(assetPath(projectId, assetId), data);
}

export async function deleteAssetFile(projectId: string, assetId: string): Promise<void> {
  try {
    await unlink(assetPath(projectId, assetId));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
