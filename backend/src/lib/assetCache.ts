import { createHash } from "crypto";
import { mkdir, readFile, writeFile, rename } from "fs/promises";
import { join, resolve } from "path";

/**
 * Cache des assets binaires lus sur le disque d'un serveur (ADR
 * `assets-on-server-disk`, décision 3).
 *
 * **C'est un cache, pas un store.** Le perdre ne perd rien : il se re-remplit au
 * prochain accès, et la vérité reste le disque du serveur. Aucune route ne doit
 * le traiter comme une source — cache vide et serveur injoignable se répondent
 * « indisponible », jamais par une version d'avant.
 *
 * La clé porte le `hash` du contenu, donc rien n'est jamais à invalider : un
 * contenu différent est une autre clé, et l'entrée périmée devient simplement
 * inatteignable (elle sera balayée par la purge, quand il y en aura une).
 *
 * Elle porte aussi le `serverKeyId` : le hash est content-addressed, donc le
 * connaître revient à connaître le contenu — mais on ne veut pas qu'un hash
 * deviné suffise à lire l'asset d'un autre tenant.
 */
export interface AssetCacheKey {
  serverKeyId: string;
  projectId: string;
  path: string;
  hash: string;
}

export function assetCacheRoot(): string {
  return resolve(process.env.ASSET_CACHE_DIR ?? "data/asset-cache");
}

/** Segment de chemin sûr et stable — le chemin brut n'entre jamais dans le FS. */
function pathKey(path: string): string {
  return createHash("sha256").update(path, "utf8").digest("hex").slice(0, 32);
}

function safeSegment(value: string, label: string): string {
  if (!value || value.includes("/") || value.includes("\\") || value.includes("..")) {
    throw new Error(`invalid ${label} for asset cache: ${value}`);
  }
  return value;
}

function entryDir(key: AssetCacheKey): string {
  if (key.path.includes("..")) throw new Error(`invalid path for asset cache: ${key.path}`);
  return join(
    assetCacheRoot(),
    safeSegment(key.serverKeyId, "serverKeyId"),
    safeSegment(key.projectId, "projectId"),
    pathKey(key.path),
  );
}

function entryFile(key: AssetCacheKey): string {
  return join(entryDir(key), `${safeSegment(key.hash, "hash")}.bin`);
}

export async function getCachedAsset(key: AssetCacheKey): Promise<Uint8Array | null> {
  try {
    return new Uint8Array(await readFile(entryFile(key)));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function putCachedAsset(key: AssetCacheKey, bytes: Uint8Array): Promise<void> {
  const dir = entryDir(key);
  await mkdir(dir, { recursive: true });
  // Écriture atomique : un lecteur concurrent voit le fichier entier ou rien.
  // Un demi-PNG dans un cache serait pire qu'un cache vide — il aurait l'air
  // valide et ne le serait pas.
  const tmp = join(dir, `${safeSegment(key.hash, "hash")}.tmp`);
  await writeFile(tmp, bytes);
  await rename(tmp, entryFile(key));
}
