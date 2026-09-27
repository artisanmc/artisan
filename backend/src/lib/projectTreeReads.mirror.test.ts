import { beforeEach, describe, expect, mock, test } from "bun:test";
import { db } from "../db";
import { networks, projects, serverKeys, snapshotBlobs } from "../db/schema";

/**
 * Lire un Project serveur passe par le miroir du Snapshot (ADR
 * `snapshot-mirror-and-backend-history`) : aucun aller-retour vers le plugin
 * tant que le miroir porte le hash que celui-ci a annoncé.
 */
const calls: { projectId: string; ifHash: string | null | undefined }[] = [];
let disk: { hash: string; files: { path: string; content: string }[] } = { hash: "H1", files: [{ path: "menus/a.yaml", content: "a1" }] };
let offline = false;
let connected = true;

mock.module("../ws/hub", () => ({
	getInstanceCount: () => (connected ? 1 : 0),
	requestProjectRead: async (_serverKeyId: string, req: { projectId: string; ifHash?: string | null }) => {
		calls.push({ projectId: req.projectId, ifHash: req.ifHash });
		if (offline) return { kind: "offline" };
		if (req.ifHash && req.ifHash === disk.hash) {
			return { kind: "result", result: { type: "project_read_result", request_id: "r", ok: true, unchanged: true, hash: disk.hash } };
		}
		return { kind: "result", result: { type: "project_read_result", request_id: "r", ok: true, hash: disk.hash, files: disk.files, binaries: [], failed: [] } };
	},
}));

const { readProjectTree, forgetProjectTree } = await import("./projectTreeReads");
const mirror = await import("./snapshotMirror");

const now = new Date();
const filesOf = (o: Awaited<ReturnType<typeof readProjectTree>>) => (o.kind === "result" ? o.result.files : undefined);

describe("readProjectTree avec miroir", () => {
	beforeEach(async () => {
		calls.length = 0;
		offline = false;
		connected = true;
		disk = { hash: "H1", files: [{ path: "menus/a.yaml", content: "a1" }] };
		mirror.forgetAllServersForTesting();
		await db.delete(snapshotBlobs);
		await db.delete(networks);
		await db.insert(networks).values({ id: "tree-net", name: "T", createdAt: now, updatedAt: now });
		await db.insert(serverKeys).values({ id: "sk", hash: "h", networkId: "tree-net", createdAt: now });
		await db.insert(projects).values({ id: "internal-shop", name: "shop", externalId: "shop", networkId: "tree-net", serverKeyId: "sk", createdAt: now, updatedAt: now });
	});

	test("miroir au hash annoncé : aucun appel au plugin", async () => {
		mirror.recordHello("sk", [{ id: "shop", hash: "H1" }]);
		await readProjectTree("sk", "shop");
		calls.length = 0;

		const outcome = await readProjectTree("sk", "shop");
		expect(calls).toHaveLength(0);
		expect(filesOf(outcome)).toEqual([{ path: "menus/a.yaml", content: "a1" }]);
		expect(outcome.kind === "result" && outcome.result.hash).toBe("H1");
	});

	test("reload annonçant un autre hash : relecture, miroir remplacé", async () => {
		mirror.recordHello("sk", [{ id: "shop", hash: "H1" }]);
		await readProjectTree("sk", "shop");

		disk = { hash: "H2", files: [{ path: "menus/a.yaml", content: "a2" }] };
		mirror.recordReload("sk", [{ id: "shop", hash: "H2" }]);
		calls.length = 0;

		expect(filesOf(await readProjectTree("sk", "shop"))).toEqual([{ path: "menus/a.yaml", content: "a2" }]);
		expect(calls).toEqual([{ projectId: "shop", ifHash: "H1" }]);
		calls.length = 0;
		await readProjectTree("sk", "shop");
		expect(calls).toHaveLength(0);
	});

	test("hash inconnu mais miroir intact : le plugin confirme sans rien transporter", async () => {
		mirror.recordHello("sk", [{ id: "shop", hash: "H1" }]);
		await readProjectTree("sk", "shop");
		forgetProjectTree("sk", "shop");
		calls.length = 0;

		expect(filesOf(await readProjectTree("sk", "shop"))).toEqual([{ path: "menus/a.yaml", content: "a1" }]);
		expect(calls).toEqual([{ projectId: "shop", ifHash: "H1" }]);
		calls.length = 0;
		await readProjectTree("sk", "shop");
		expect(calls).toHaveLength(0);
	});

	test("plugin hors ligne : même résultat qu'avant, miroir intact", async () => {
		mirror.recordHello("sk", [{ id: "shop", hash: "H1" }]);
		await readProjectTree("sk", "shop");
		forgetProjectTree("sk", "shop");
		offline = true;
		expect((await readProjectTree("sk", "shop")).kind).toBe("offline");
		expect((await mirror.getSnapshot("internal-shop"))?.hash).toBe("H1");
	});

	test("sans la capacité, le miroir n'est jamais servi", async () => {
		await readProjectTree("sk", "shop");
		await readProjectTree("sk", "shop", { maxAgeMs: 0 });
		expect(calls).toHaveLength(2);
		expect(calls.every((c) => !c.ifHash)).toBe(true);
	});

	test("un Project inconnu de la base est lu au plugin sans miroir", async () => {
		mirror.recordHello("sk", [{ id: "ghost", hash: "H1" }]);
		await readProjectTree("sk", "ghost");
		await readProjectTree("sk", "ghost");
		expect(calls).toHaveLength(2);
	});

	test("serveur déconnecté : la dernière copie est servie, datée, sans le plugin", async () => {
		mirror.recordHello("sk", [{ id: "shop", hash: "H1" }]);
		await readProjectTree("sk", "shop");
		mirror.forgetServer("sk");
		connected = false;
		calls.length = 0;

		const outcome = await readProjectTree("sk", "shop");
		expect(calls).toHaveLength(0);
		expect(filesOf(outcome)).toEqual([{ path: "menus/a.yaml", content: "a1" }]);
		expect(outcome.kind === "result" && typeof outcome.result.offline_since).toBe("string");
	});

	test("serveur déconnecté sans copie : hors ligne, comme avant", async () => {
		connected = false;
		offline = true;
		expect((await readProjectTree("sk", "shop")).kind).toBe("offline");
	});
});
