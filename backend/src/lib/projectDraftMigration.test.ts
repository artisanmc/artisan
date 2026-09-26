import { beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { networks, projectDraftBlobs, projectDrafts, projectDraftStorage, projects, serverKeys, users } from "../db/schema";
import { returnProjectDrafts } from "./projectDraftMigration";
import { getProject } from "./projectStorage";
import type { StoredDraft } from "./storage/DraftStore";
import type { DraftRequest } from "./storage/ServerDraftStore";

/**
 * Les brouillons partis sur le disque du serveur (2026-09-13) reviennent dans le
 * backend (ADR `snapshot-mirror-and-backend-history`, décision 4) : gel, copie,
 * vérification, bascule — un échec laisse tout en place, jamais à moitié.
 */
const now = new Date("2026-09-26T00:00:00Z");
const png = Buffer.from("image");
const sha = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const envelope = (id: string, ownerId: string, status = "active", extra: Partial<StoredDraft["snapshot"]> = {}): StoredDraft => ({
	schema: "artisan-draft/v1", id, ownerId, name: id, revision: 3, status, updatedBy: ownerId, source: "editor",
	createdAt: now.toISOString(), updatedAt: now.toISOString(),
	snapshot: { baseline: { "a.yaml": "old" }, tree: { "a.yaml": "new" }, at: 1, ...extra },
});

let disk: StoredDraft[];
let blobs: Record<string, string>;
let requests: DraftRequest[];
const transport = async (_server: string, request: DraftRequest) => {
	requests.push(request);
	if (request.action === "list_all") return { kind: "result" as const, result: { ok: true, drafts: structuredClone(disk) } };
	if (request.action === "read_blob") {
		const content = blobs[`${request.draft_id}:${request.hash}`];
		return { kind: "result" as const, result: content ? { ok: true, content_base64: content } : { ok: false, error: "not_found" } };
	}
	return { kind: "result" as const, result: { ok: false, error: "unexpected" } };
};
const gate = async () => (await db.select().from(projectDraftStorage))[0]?.state;

beforeEach(async () => {
	disk = [];
	blobs = {};
	requests = [];
	await db.delete(networks);
	await db.delete(users);
	await db.insert(users).values(["owner", "other"].map((id) => ({ id, email: `${id}@t.com`, name: id, createdAt: now, updatedAt: now })));
	await db.insert(networks).values({ id: "network", name: "N", createdAt: now, updatedAt: now });
	await db.insert(serverKeys).values({ id: "server", hash: "h", networkId: "network", createdAt: now });
	await db.insert(projects).values({ id: "project", networkId: "network", serverKeyId: "server", externalId: "folder", name: "P", createdAt: now, updatedAt: now });
	await db.insert(projectDraftStorage).values({ projectId: "project", state: "server", migrationId: "m", updatedAt: now });
});

test("tous les brouillons reviennent, terminaux compris, puis le backend reprend la main", async () => {
	disk = [envelope("d1", "owner"), envelope("d2", "other", "published"), envelope("d3", "owner", "discarded")];
	await returnProjectDrafts((await getProject("project"))!, transport);

	expect(await gate()).toBe("backend");
	const rows = await db.select().from(projectDrafts);
	expect(rows.map((r) => [r.id, r.ownerId, r.status, r.revision]).sort()).toEqual([["d1", "owner", "active", 3], ["d2", "other", "published", 3], ["d3", "owner", "discarded", 3]]);
	expect(rows.find((r) => r.id === "d1")!.snapshot.tree).toEqual({ "a.yaml": "new" });
	// Rien n'est effacé sur le disque (décision B) : aucune écriture vers le plugin.
	expect(requests.every((r) => r.action === "list_all" || r.action === "read_blob")).toBe(true);
});

test("les images modifiées reviennent avec leurs octets vérifiés", async () => {
	const binaryTree = { "assets/textures/x.png": { hash: sha(png), size: png.length } };
	disk = [envelope("d1", "owner", "active", { binaryBaseline: {}, binaryTree })];
	blobs[`d1:${sha(png)}`] = png.toString("base64");
	await returnProjectDrafts((await getProject("project"))!, transport);

	expect(await gate()).toBe("backend");
	const [blob] = await db.select().from(projectDraftBlobs);
	expect(Buffer.from(blob!.content).toString()).toBe("image");
});

test("une image corrompue ou absente : rien ne bascule, et on réessaie plus tard", async () => {
	const binaryTree = { "assets/textures/x.png": { hash: sha(png), size: png.length } };
	disk = [envelope("d1", "owner", "active", { binaryBaseline: {}, binaryTree })];
	blobs[`d1:${sha(png)}`] = Buffer.from("autre").toString("base64");
	await returnProjectDrafts((await getProject("project"))!, transport);
	expect(await gate()).toBe("returning");
	expect(await db.select().from(projectDrafts)).toHaveLength(0);

	blobs[`d1:${sha(png)}`] = png.toString("base64");
	await returnProjectDrafts((await getProject("project"))!, transport);
	expect(await gate()).toBe("backend");
	expect(await db.select().from(projectDrafts)).toHaveLength(1);
});

test("un brouillon dont l'auteur n'existe plus n'est pas rapatrié", async () => {
	disk = [envelope("d1", "owner"), envelope("d2", "ghost")];
	await returnProjectDrafts((await getProject("project"))!, transport);
	expect((await db.select().from(projectDrafts)).map((r) => r.id)).toEqual(["d1"]);
});

test("un ancien gel vers le disque se lève sans rien demander au plugin", async () => {
	await db.update(projectDraftStorage).set({ state: "frozen" }).where(eq(projectDraftStorage.projectId, "project"));
	await returnProjectDrafts((await getProject("project"))!, async () => { throw new Error("must not call the plugin"); });
	expect(await gate()).toBe("backend");
});

test("serveur injoignable : le Project reste gelé, rien n'est perdu", async () => {
	await returnProjectDrafts((await getProject("project"))!, async () => ({ kind: "offline" as const }));
	expect(await gate()).toBe("returning");
});
