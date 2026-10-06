import { afterEach, expect, test } from "bun:test";
import { db } from "../db";
import { networks, serverKeys } from "../db/schema";
import { generateServerKey } from "../lib/auth";
import { cleanupConn, handlePluginMessage, pluginStatus, registerConn, requestPluginUpdate } from "./hub";

afterEach(() => cleanupConn("plugin-update"));

async function connect(capabilities: string[]) {
	await db.delete(networks);
	const now = new Date();
	await db.insert(networks).values({ id: "plugin-update", name: "N", createdAt: now, updatedAt: now });
	const key = await generateServerKey();
	await db.insert(serverKeys).values({ id: key.id, hash: key.hash, networkId: "plugin-update", createdAt: now });
	const sent: Record<string, unknown>[] = [];
	registerConn("plugin-update", (m) => sent.push(JSON.parse(m)));
	const hello = (version: string, caps = capabilities) =>
		handlePluginMessage("plugin-update", JSON.stringify({ type: "hello", content_version: 2, server_key: key.key, plugin_version: version, minecraft_version: "26.2", current_bundle_hash: "", local_project_ids: [], capabilities: caps }));
	await hello("1.0.1");
	return { serverId: key.id, sent, hello };
}

test("un vieux plugin sans la capacité ne reçoit jamais de demande", async () => {
	const { serverId, sent } = await connect([]);
	expect(pluginStatus(serverId)).toEqual({ version: "1.0.1", canUpdate: false, pendingVersion: null });
	expect(await requestPluginUpdate(serverId)).toEqual({ kind: "unsupported" });
	expect(sent.some((m) => m.type === "plugin_update")).toBe(false);
});

test("l'installation réussie reste en attente jusqu'au hello de la nouvelle version", async () => {
	const { serverId, sent, hello } = await connect(["plugin_update_v1"]);
	expect(pluginStatus(serverId).canUpdate).toBe(true);
	const pending = requestPluginUpdate(serverId);
	const request = sent.find((m) => m.type === "plugin_update");
	expect(request).toBeDefined();
	await handlePluginMessage("plugin-update", JSON.stringify({ type: "plugin_update_result", request_id: request?.request_id, ok: true, version: "1.0.2" }));
	expect(await pending).toEqual({ kind: "result", result: expect.objectContaining({ ok: true, version: "1.0.2" }) });
	expect(pluginStatus(serverId).pendingVersion).toBe("1.0.2");

	await hello("1.0.2");
	expect(pluginStatus(serverId)).toEqual({ version: "1.0.2", canUpdate: true, pendingVersion: null });
});

test("un échec du plugin n'annonce rien en attente", async () => {
	const { serverId, sent } = await connect(["plugin_update_v1"]);
	const pending = requestPluginUpdate(serverId);
	const request = sent.find((m) => m.type === "plugin_update");
	await handlePluginMessage("plugin-update", JSON.stringify({ type: "plugin_update_result", request_id: request?.request_id, ok: false, error: "invalid_signature" }));
	expect((await pending).kind).toBe("result");
	expect(pluginStatus(serverId).pendingVersion).toBeNull();
});
