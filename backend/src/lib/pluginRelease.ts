import { createPublicKey, verify } from "crypto";
import { existsSync, readFileSync } from "fs";
import { mkdir, rename, writeFile } from "fs/promises";
import { join, resolve } from "path";

/**
 * Dernier JAR du plugin, servi aux serveurs pour la mise à jour depuis l'éditeur.
 * Le déploiement l'envoie signé (Ed25519) ; seule la clé privée de la CI peut
 * produire un JAR accepté ici ET par le plugin, qui revérifie avec la même clé.
 */
export const PLUGIN_RELEASE_PUBLIC_KEY = "MCowBQYDK2VwAyEAszAX3rGRYvjdGI8PnJmuCjsKh0jOA1v6cKbfawbw5ws=";

export type PluginRelease = { version: string; sha256: string; signature: string; size: number; commit: string | null };
type Options = { root?: string; publicKey?: string };

export const pluginReleaseRoot = () => process.env.PLUGIN_RELEASE_DIR ?? resolve("data/plugin-release");
export const pluginJarPath = (root = pluginReleaseRoot()) => join(root, "artisan.jar");

/** Ce que la signature couvre : la version ET le contenu, pour qu'un JAR signé ne puisse pas être rejoué sous un autre numéro. */
export const releaseMessage = (version: string, sha256: string) => `artisan-plugin\n${version}\n${sha256}`;

/** Les releases sont `1.0.<run CI>` ; une version de dev (`-SNAPSHOT`) vaut 0. */
export function buildNumber(version: string | null | undefined): number {
	const m = /^\d+\.\d+\.(\d+)$/.exec(version ?? "");
	return m ? Number(m[1]) : 0;
}

export function verifyRelease(version: string, sha256: string, signature: string, publicKey = PLUGIN_RELEASE_PUBLIC_KEY): boolean {
	try {
		const key = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
		return verify(null, Buffer.from(releaseMessage(version, sha256)), key, Buffer.from(signature, "base64"));
	} catch {
		return false;
	}
}

export function readRelease(root = pluginReleaseRoot()): PluginRelease | null {
	const file = join(root, "release.json");
	if (!existsSync(file) || !existsSync(pluginJarPath(root))) return null;
	try {
		return JSON.parse(readFileSync(file, "utf8")) as PluginRelease;
	} catch {
		return null;
	}
}

export async function storeRelease(
	bytes: Uint8Array,
	version: string,
	signature: string,
	commit: string | null,
	{ root = pluginReleaseRoot(), publicKey }: Options = {},
): Promise<{ ok: true } | { ok: false; error: "invalid_signature" | "not_newer" }> {
	const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
	if (buildNumber(version) === 0 || !verifyRelease(version, sha256, signature, publicKey)) return { ok: false, error: "invalid_signature" };
	if (buildNumber(version) <= buildNumber(readRelease(root)?.version)) return { ok: false, error: "not_newer" };
	await mkdir(root, { recursive: true });
	await writeFile(join(root, "artisan.jar.tmp"), bytes);
	await rename(join(root, "artisan.jar.tmp"), pluginJarPath(root));
	const release: PluginRelease = { version, sha256, signature, size: bytes.length, commit };
	await writeFile(join(root, "release.json.tmp"), JSON.stringify(release));
	await rename(join(root, "release.json.tmp"), join(root, "release.json"));
	return { ok: true };
}
