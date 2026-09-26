import { afterEach, expect, test } from "bun:test";
import { db } from "../db";
import { networks, serverKeys } from "../db/schema";
import { generateServerKey } from "../lib/auth";
import { readProjectTree } from "../lib/projectTreeReads";
import { mirrorSupported } from "../lib/snapshotMirror";
import { cleanupConn, handlePluginMessage, registerConn } from "./hub";

/**
 * Le hub tient le miroir du Snapshot à jour (ADR
 * `snapshot-mirror-and-backend-history`) : rempli au `hello` et au reload,
 * oublié à la déconnexion, jamais cru pour un ancien plugin.
 */
const CONN = "snapshot-mirror";
afterEach(() => cleanupConn(CONN));

async function until(check: () => boolean) {
	for (let i = 0; i < 100 && !check(); i++) await new Promise((r) => setTimeout(r, 10));
	expect(check()).toBe(true);
}

async function connect() {
	await db.delete(networks);
	const now = new Date();
	await db.insert(networks).values({ id: "mirror-hub", name: "N", createdAt: now, updatedAt: now });
	const key = await generateServerKey();
	await db.insert(serverKeys).values({ id: key.id, hash: key.hash, networkId: "mirror-hub", createdAt: now });
	const sent: Record<string, unknown>[] = [];
	registerConn(CONN, (raw) => sent.push(JSON.parse(raw)));
	let disk = { hash: "H1", content: "size: 27" };
	const reads = () => sent.filter((m) => m.type === "project_read");
	// Le faux plugin répond à chaque `project_read` avec son disque du moment.
	const answer = async () => {
		for (const m of reads()) {
			if (m.answered) continue;
			m.answered = true;
			const unchanged = m.if_hash === disk.hash;
			await handlePluginMessage(CONN, JSON.stringify({
				type: "project_read_result", request_id: m.request_id, ok: true, hash: disk.hash,
				...(unchanged ? { unchanged: true } : { files: [{ path: "menus/m.yaml", content: disk.content }], binaries: [], failed: [] }),
			}));
		}
	};
	const hello = (capabilities: string[]) =>
		handlePluginMessage(CONN, JSON.stringify({
			type: "hello", server_key: key.key, plugin_version: "test", minecraft_version: "26.2", current_bundle_hash: "",
			local_project_ids: ["shop"], snapshot_hashes: [{ id: "shop", hash: disk.hash }], capabilities,
		}));
	return { key, sent, reads, answer, hello, setDisk: (d: typeof disk) => (disk = d) };
}

test("hello capable : le miroir se remplit, puis les lectures ne vont plus au plugin", async () => {
	const s = await connect();
	await s.hello(["snapshot_mirror_v1"]);
	await until(() => s.reads().length === 1);
	await s.answer();

	await until(() => mirrorSupported(s.key.id));
	const before = s.reads().length;
	const outcome = await readProjectTree(s.key.id, "shop");
	expect(outcome.kind === "result" && outcome.result.files).toEqual([{ path: "menus/m.yaml", content: "size: 27" }]);
	expect(s.reads().length).toBe(before);
});

test("projects_reloaded avec un autre hash : relecture présentant l'ancien hash", async () => {
	const s = await connect();
	await s.hello(["snapshot_mirror_v1"]);
	await until(() => s.reads().length === 1);
	await s.answer();
	await new Promise((r) => setTimeout(r, 50));

	s.setDisk({ hash: "H2", content: "size: 54" });
	await handlePluginMessage(CONN, JSON.stringify({ type: "projects_reloaded", projects: [{ id: "shop", hash: "H2" }] }));
	await until(() => s.reads().length === 2);
	expect(s.reads()[1]!.if_hash).toBe("H1");
	await s.answer();
	await new Promise((r) => setTimeout(r, 50));

	const outcome = await readProjectTree(s.key.id, "shop");
	expect(outcome.kind === "result" && outcome.result.files).toEqual([{ path: "menus/m.yaml", content: "size: 54" }]);
	expect(s.reads().length).toBe(2);
});

test("ancien plugin : aucun remplissage, miroir jamais cru", async () => {
	const s = await connect();
	await s.hello([]);
	await new Promise((r) => setTimeout(r, 50));
	expect(s.reads()).toHaveLength(0);
	expect(mirrorSupported(s.key.id)).toBe(false);
});

test("la déconnexion oublie le miroir", async () => {
	const s = await connect();
	await s.hello(["snapshot_mirror_v1"]);
	await until(() => s.reads().length === 1);
	await s.answer();
	cleanupConn(CONN);
	expect(mirrorSupported(s.key.id)).toBe(false);
});

test("la liste des Projects vient du Snapshot annoncé, sans demander au plugin", async () => {
	const { listProjectsFromSnapshot } = await import("./hub");
	const s = await connect();
	await s.hello([]);
	expect(await listProjectsFromSnapshot(s.key.id)).toBeNull();

	await s.hello(["snapshot_mirror_v1"]);
	const listed = await listProjectsFromSnapshot(s.key.id);
	expect(listed?.kind === "result" && listed.result.project_ids).toEqual(["shop"]);
	await handlePluginMessage(CONN, JSON.stringify({ type: "projects_reloaded", projects: [{ id: "shop", hash: "H1" }, { id: "warps", hash: "W" }] }));
	const after = await listProjectsFromSnapshot(s.key.id);
	expect(after?.kind === "result" && after.result.project_ids).toEqual(["shop", "warps"]);
	expect(s.sent.filter((m) => m.type === "project_list")).toHaveLength(0);
});
