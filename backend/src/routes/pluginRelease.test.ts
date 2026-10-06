import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "crypto";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { app } from "../app";
import { db } from "../db/index";
import { serverKeys } from "../db/schema";
import { generateServerKey } from "../lib/auth";
import { releaseMessage, storeRelease } from "../lib/pluginRelease";
import { createSession } from "../lib/sessionManager";
import { users } from "../db/schema";
import { cleanupConn, handlePluginMessage, registerConn } from "../ws/hub";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyB64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
const root = mkdtempSync(join(tmpdir(), "plugin-release-route-"));
const previousDir = process.env.PLUGIN_RELEASE_DIR;

async function publish(version: string, body = `jar ${version}`) {
	const bytes = new TextEncoder().encode(body);
	const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
	const signature = sign(null, Buffer.from(releaseMessage(version, sha256)), privateKey).toString("base64");
	expect(await storeRelease(bytes, version, signature, "abc", { root, publicKey: publicKeyB64 })).toEqual({ ok: true });
}

async function member(id: string) {
	await db.insert(users).values({ id, email: `${id}@a.b`, name: id, passwordHash: null, avatarUrl: null, createdAt: new Date(), updatedAt: new Date() }).onConflictDoNothing();
	return { Cookie: `artisan_user_session=${(await createSession(id)).id}`, "Content-Type": "application/json" };
}

beforeAll(() => { process.env.PLUGIN_RELEASE_DIR = root; });
afterAll(() => {
	if (previousDir === undefined) delete process.env.PLUGIN_RELEASE_DIR;
	else process.env.PLUGIN_RELEASE_DIR = previousDir;
	cleanupConn("release-conn");
});

describe("/api/v1/plugin-release", () => {
	test("refuse un JAR non signé par la clé de release", async () => {
		const res = await app.request("/api/v1/plugin-release", {
			method: "PUT",
			headers: { "X-Artisan-Plugin-Version": "1.0.5", "X-Artisan-Plugin-Signature": Buffer.from("nope").toString("base64") },
			body: "evil",
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toEqual({ error: "invalid_signature" });
	});

	test("sert les métadonnées publiquement et le JAR aux seuls serveurs authentifiés", async () => {
		await publish("1.0.3");
		const meta = await app.request("/api/v1/plugin-release");
		expect(meta.status).toBe(200);
		expect(await meta.json()).toMatchObject({ version: "1.0.3", size: 9 });

		expect((await app.request("/api/v1/plugin-release/artisan.jar")).status).toBe(401);
		const key = await generateServerKey();
		const { network } = await (await app.request("/api/v1/networks", { method: "POST", headers: await member("release-dl"), body: JSON.stringify({ name: "DL" }) })).json();
		await db.insert(serverKeys).values({ id: key.id, hash: key.hash, networkId: network.id, createdAt: new Date() });
		const jar = await app.request("/api/v1/plugin-release/artisan.jar", { headers: { Authorization: `Bearer ${key.key}` } });
		expect(jar.status).toBe(200);
		expect(await jar.text()).toBe("jar 1.0.3");
	});
});

describe("POST …/servers/:serverId/plugin-update", () => {
	test("tout membre du network déclenche l'installation sur un serveur en retard", async () => {
		await publish("1.0.4");
		const headers = await member("release-owner");
		const { network } = await (await app.request("/api/v1/networks", { method: "POST", headers, body: JSON.stringify({ name: "Upd" }) })).json();
		const key = await generateServerKey();
		await db.insert(serverKeys).values({ id: key.id, hash: key.hash, networkId: network.id, createdAt: new Date() });
		const url = `/api/v1/networks/${network.id}/servers/${key.id}/plugin-update`;

		expect((await app.request(url, { method: "POST", headers: await member("release-outsider") })).status).toBe(403);
		expect((await app.request(url, { method: "POST", headers })).status).toBe(503);

		registerConn("release-conn", (raw) => {
			const msg = JSON.parse(raw);
			if (msg.type !== "plugin_update") return;
			void handlePluginMessage("release-conn", JSON.stringify({ type: "plugin_update_result", request_id: msg.request_id, ok: true, version: "1.0.4" }));
		});
		const hello = (version: string) => handlePluginMessage("release-conn", JSON.stringify({ type: "hello", content_version: 2, server_key: key.key, plugin_version: version, minecraft_version: "26.2", current_bundle_hash: "", local_project_ids: [], capabilities: ["plugin_update_v1"] }));
		await hello("1.0.2");

		const status = async () => (await (await app.request(`/api/v1/networks/${network.id}/servers-status`, { headers })).json()).servers[0];
		expect(await status()).toMatchObject({ pluginVersion: "1.0.2", pluginUpdateVersion: "1.0.4", pluginUpdatePending: null });

		const res = await app.request(url, { method: "POST", headers });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ version: "1.0.4" });
		expect(await status()).toMatchObject({ pluginUpdateVersion: null, pluginUpdatePending: "1.0.4" });

		await hello("1.0.4");
		expect(await status()).toMatchObject({ pluginVersion: "1.0.4", pluginUpdateVersion: null, pluginUpdatePending: null });
		expect((await app.request(url, { method: "POST", headers })).status).toBe(409);
	});
});
