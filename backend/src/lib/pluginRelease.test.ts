import { describe, expect, it } from "bun:test";
import { generateKeyPairSync, sign } from "crypto";
import { existsSync, mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildNumber, readRelease, releaseMessage, storeRelease } from "./pluginRelease";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

function signed(bytes: Uint8Array, version: string, key = privateKey) {
	const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
	return sign(null, Buffer.from(releaseMessage(version, sha256)), key).toString("base64");
}

const jar = (s: string) => new TextEncoder().encode(s);
const dir = () => mkdtempSync(join(tmpdir(), "plugin-release-"));

describe("buildNumber", () => {
	it("lit le dernier composant d'une version de release", () => {
		expect(buildNumber("1.0.42")).toBe(42);
	});
	it("vaut 0 pour une version de dev", () => {
		expect(buildNumber("1.0.0-SNAPSHOT")).toBe(0);
		expect(buildNumber(undefined)).toBe(0);
	});
});

describe("storeRelease", () => {
	it("stocke un JAR signé et ses métadonnées", async () => {
		const root = dir();
		const bytes = jar("v1");
		const out = await storeRelease(bytes, "1.0.1", signed(bytes, "1.0.1"), "abc", { root, publicKey: publicKeyB64 });
		expect(out).toEqual({ ok: true });
		expect(readFileSync(join(root, "artisan.jar"), "utf8")).toBe("v1");
		expect(readRelease(root)).toMatchObject({ version: "1.0.1", size: 2, commit: "abc" });
	});

	it("refuse une signature d'une autre clé sans rien écrire", async () => {
		const root = dir();
		const bytes = jar("evil");
		const other = generateKeyPairSync("ed25519").privateKey;
		const out = await storeRelease(bytes, "1.0.1", signed(bytes, "1.0.1", other), null, { root, publicKey: publicKeyB64 });
		expect(out).toEqual({ ok: false, error: "invalid_signature" });
		expect(existsSync(join(root, "artisan.jar"))).toBe(false);
	});

	it("refuse une signature valide rejouée sous une autre version", async () => {
		const root = dir();
		const bytes = jar("v1");
		const out = await storeRelease(bytes, "1.0.9", signed(bytes, "1.0.1"), null, { root, publicKey: publicKeyB64 });
		expect(out).toEqual({ ok: false, error: "invalid_signature" });
	});

	it("refuse une version qui n'est pas plus récente", async () => {
		const root = dir();
		const v2 = jar("v2");
		await storeRelease(v2, "1.0.2", signed(v2, "1.0.2"), null, { root, publicKey: publicKeyB64 });
		const v1 = jar("v1");
		const out = await storeRelease(v1, "1.0.1", signed(v1, "1.0.1"), null, { root, publicKey: publicKeyB64 });
		expect(out).toEqual({ ok: false, error: "not_newer" });
		expect(readRelease(root)?.version).toBe("1.0.2");
	});
});
