import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { db } from "../../db";
import { networks, projectDrafts, projects, serverKeys, users } from "../../db/schema";
import type { DraftSnapshot } from "./DraftStore";
import type { ProjectStorage, ProjectWriteBatch } from "./ProjectStorage";
import { SqlDraftStore } from "./SqlDraftStore";

/**
 * Les brouillons des projets serveur vivent dans le backend (ADR
 * `snapshot-mirror-and-backend-history`, décisions 4 et 5) : images comprises,
 * publiés d'un bloc, et rebasés sur le Snapshot courant à l'ouverture.
 */
const now = new Date("2026-09-26T00:00:00Z");
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const png = Buffer.from("new-image");
const b64 = png.toString("base64");

let server: { files: Record<string, string>; binaries: Record<string, { hash: string; size: number }> };
let writes: ProjectWriteBatch[];
const storage = {
	read: async () => ({
		kind: "result" as const,
		result: {
			ok: true,
			hash: "H",
			files: Object.entries(server.files).map(([path, content]) => ({ path, content })),
			binaries: Object.entries(server.binaries).map(([path, meta]) => ({ path, ...meta })),
			failed: [],
		},
	}),
	write: async (batch: ProjectWriteBatch) => {
		writes.push(batch);
		return { kind: "result" as const, result: { ok: true } };
	},
} as unknown as ProjectStorage;

const store = (owner = "owner") => new SqlDraftStore("project", owner, storage);
const body = (snapshot: Partial<DraftSnapshot>) => ({
	name: "Mon brouillon",
	snapshot: { baseline: {}, tree: {}, at: 1, ...snapshot } as DraftSnapshot,
});
const ok = <T>(outcome: { kind: string; result?: T }) => (outcome as { result: T }).result;

beforeEach(async () => {
	server = { files: { "menus/a.yaml": "a1", "menus/b.yaml": "b1" }, binaries: { "assets/textures/logo.png": { hash: sha("old"), size: 3 } } };
	writes = [];
	await db.delete(networks);
	await db.delete(users);
	await db.insert(users).values(["owner", "other"].map((id) => ({ id, email: `${id}@t.com`, name: id, createdAt: now, updatedAt: now })));
	await db.insert(networks).values({ id: "network", name: "N", createdAt: now, updatedAt: now });
	await db.insert(serverKeys).values({ id: "server", hash: "h", networkId: "network", createdAt: now });
	await db.insert(projects).values({ id: "project", networkId: "network", serverKeyId: "server", externalId: "folder", name: "P", createdAt: now, updatedAt: now });
});

describe("images", () => {
	test("une image envoyée se relit, seulement par son propriétaire", async () => {
		await store().create("d1", "op1", body({ baseline: server.files, tree: server.files }));
		expect(ok<{ ok: boolean }>(await store().writeBlob("d1", 1, "op2", sha(png), b64)).ok).toBe(true);
		expect(ok<{ content_base64: string }>(await store().readBlob("d1", sha(png))).content_base64).toBe(b64);
		expect(ok<{ error: string }>(await store("other").readBlob("d1", sha(png))).error).toBe("not_found");
	});

	test("contenu qui ne correspond pas au hash refusé", async () => {
		await store().create("d1", "op1", body({}));
		expect(ok<{ error: string }>(await store().writeBlob("d1", 1, "op2", sha("autre"), b64)).error).toBe("invalid_blob");
	});

	test("une image modifiée doit avoir ses octets ; une image inchangée non", async () => {
		const binaryBaseline = server.binaries;
		await store().create("d1", "op1", body({ binaryBaseline, binaryTree: binaryBaseline }));
		const changed = { "assets/textures/logo.png": { hash: sha(png), size: png.length } };
		expect(ok<{ error: string }>(await store().update("d1", 1, "op2", body({ binaryBaseline, binaryTree: changed }))).error).toBe("missing_blob");
		await store().writeBlob("d1", 1, "op3", sha(png), b64);
		expect(ok<{ ok: boolean }>(await store().update("d1", 1, "op4", body({ binaryBaseline, binaryTree: changed }))).ok).toBe(true);
	});

	test("un nouveau brouillon reprend les images d'un autre brouillon du même auteur", async () => {
		await store().create("d1", "op1", body({}));
		await store().writeBlob("d1", 1, "op2", sha(png), b64);
		const tree = { "assets/textures/new.png": { hash: sha(png), size: png.length } };
		expect(ok<{ ok: boolean }>(await store().create("d2", "op3", body({ binaryTree: tree }))).ok).toBe(true);
		expect(ok<{ content_base64: string }>(await store().readBlob("d2", sha(png))).content_base64).toBe(b64);
	});
});

test("publier écrit texte et images d'un bloc, puis clôt le brouillon", async () => {
	const binaryBaseline = server.binaries;
	const binaryTree = { "assets/textures/logo.png": { hash: sha(png), size: png.length } };
	await store().create("d1", "op1", body({ baseline: server.files, tree: { ...server.files, "menus/a.yaml": "a2" }, binaryBaseline }));
	await store().writeBlob("d1", 1, "op2", sha(png), b64);
	await store().update("d1", 1, "op3", body({ baseline: server.files, tree: { ...server.files, "menus/a.yaml": "a2" }, binaryBaseline, binaryTree }));

	const published = ok<{ ok: boolean; draft: { status: string } }>(await store().publish("d1", 2, "op4"));
	expect(published.ok).toBe(true);
	expect(published.draft.status).toBe("published");
	expect(writes).toHaveLength(1);
	expect(writes[0]!.files).toEqual([{ path: "menus/a.yaml", content: "a2", base_hash: sha("a1") }]);
	expect(writes[0]!.operationId).toBe("op4");
	expect(writes[0]!.binaries).toEqual([{ path: "assets/textures/logo.png", content: new Uint8Array(png), baseHash: sha("old") }]);
});

describe("à l'ouverture", () => {
	test("les fichiers modifiés seulement sur le serveur avancent ; les deux côtés = conflit", async () => {
		const baseline = { "menus/a.yaml": "a1", "menus/b.yaml": "b1", "menus/c.yaml": "c1" };
		await store().create("d1", "op1", body({ baseline, tree: { ...baseline, "menus/b.yaml": "b-mine", "menus/c.yaml": "c-mine" } }));
		server.files = { "menus/a.yaml": "a-server", "menus/b.yaml": "b1", "menus/c.yaml": "c-server" };

		const read = ok<{ draft: { snapshot: DraftSnapshot; conflicts: unknown } }>(await store().read("d1"));
		expect(read.draft.snapshot.tree).toEqual({ "menus/a.yaml": "a-server", "menus/b.yaml": "b-mine", "menus/c.yaml": "c-mine" });
		expect(read.draft.snapshot.baseline).toEqual({ "menus/a.yaml": "a-server", "menus/b.yaml": "b1", "menus/c.yaml": "c1" });
		expect(read.draft.conflicts).toEqual([{ path: "menus/c.yaml", disk: "c-server" }]);
		const listed = ok<{ drafts: { conflicts: unknown }[] }>(await store().list());
		expect(listed.drafts[0]!.conflicts).toEqual([{ path: "menus/c.yaml", disk: "c-server" }]);
		// Rien n'est écrit : la révision reste celle que l'éditeur connaît.
		const [row] = await db.select().from(projectDrafts);
		expect(row!.revision).toBe(1);
	});

	test("un fichier supprimé sur le serveur et intact dans le brouillon disparaît", async () => {
		await store().create("d1", "op1", body({ baseline: server.files, tree: server.files }));
		server.files = { "menus/a.yaml": "a1" };
		const read = ok<{ draft: { snapshot: DraftSnapshot; conflicts?: unknown } }>(await store().read("d1"));
		expect(read.draft.snapshot.tree).toEqual({ "menus/a.yaml": "a1" });
		expect(read.draft.conflicts).toBeUndefined();
	});

	test("serveur injoignable : le brouillon est rendu tel quel", async () => {
		await store().create("d1", "op1", body({ baseline: { "menus/a.yaml": "a0" }, tree: { "menus/a.yaml": "a0" } }));
		const offline = new SqlDraftStore("project", "owner", { read: async () => ({ kind: "offline" }) } as unknown as ProjectStorage);
		const read = ok<{ draft: { snapshot: DraftSnapshot; conflicts?: unknown } }>(await offline.read("d1"));
		expect(read.draft.snapshot.tree).toEqual({ "menus/a.yaml": "a0" });
		expect(read.draft.conflicts).toBeUndefined();
	});
});
