import { afterEach, expect, test } from "bun:test";
import { db } from "../db";
import { networks, serverKeys } from "../db/schema";
import { generateServerKey } from "../lib/auth";
import { containerTextureRefs, serverConfig } from "../lib/serverConfig";
import { cleanupConn, handlePluginMessage, registerConn, requestServerConfigWrite } from "./hub";

afterEach(() => cleanupConn("server-config"));

async function connect(config?: Record<string, unknown>) {
	await db.delete(networks);
	const now = new Date();
	await db.insert(networks).values({ id: "server-config", name: "N", createdAt: now, updatedAt: now });
	const key = await generateServerKey();
	await db.insert(serverKeys).values({ id: key.id, hash: key.hash, networkId: "server-config", createdAt: now });
	const sent: Record<string, unknown>[] = [];
	registerConn("server-config", (m) => sent.push(JSON.parse(m)));
	await handlePluginMessage("server-config", JSON.stringify({ type: "hello", content_version: 2, server_key: key.key, plugin_version: "1.0.1", minecraft_version: "26.2", current_bundle_hash: "", local_project_ids: [], ...(config ? { server_config: config } : {}) }));
	return { serverId: key.id, sent };
}

test("le hello rapporte la config éditable", async () => {
	const { serverId } = await connect({ language: "fr", "resource-pack.container-textures.chest": "ui:menu_items" });
	expect(serverConfig(serverId)).toEqual({ language: "fr", "resource-pack.container-textures.chest": "ui:menu_items" });
	expect(containerTextureRefs(serverId)).toEqual({ chest: "ui:menu_items", hopper: undefined, dispenser: undefined });
});

test("un vieux plugin sans config ne reçoit jamais d'écriture", async () => {
	const { serverId, sent } = await connect();
	expect(serverConfig(serverId)).toBeNull();
	expect(await requestServerConfigWrite(serverId, { language: "fr" })).toEqual({ kind: "unsupported" });
	expect(sent.some((m) => m.type === "server_config_write")).toBe(false);
});

test("une écriture acceptée remplace la config connue", async () => {
	const { serverId, sent } = await connect({ language: "en" });
	const pending = requestServerConfigWrite(serverId, { language: "fr" });
	const request = sent.find((m) => m.type === "server_config_write");
	expect(request?.changes).toEqual({ language: "fr" });
	await handlePluginMessage("server-config", JSON.stringify({ type: "server_config_write_result", request_id: request?.request_id, ok: true, server_config: { language: "fr" } }));
	expect((await pending).kind).toBe("result");
	expect(serverConfig(serverId)).toEqual({ language: "fr" });
});

test("un refus garde la config connue", async () => {
	const { serverId, sent } = await connect({ language: "en" });
	const pending = requestServerConfigWrite(serverId, { language: 3 });
	const request = sent.find((m) => m.type === "server_config_write");
	await handlePluginMessage("server-config", JSON.stringify({ type: "server_config_write_result", request_id: request?.request_id, ok: false, error: "invalid_config", message: "language: invalid_type" }));
	expect(await pending).toEqual({ kind: "result", result: expect.objectContaining({ ok: false, message: "language: invalid_type" }) });
	expect(serverConfig(serverId)).toEqual({ language: "en" });
});
