import { beforeEach, expect, test } from "bun:test";
import { db } from "../db";
import { networks, projects, projectVersions, serverKeys, snapshotBlobs, users } from "../db/schema";
import { fileHistory, listVersions, readVersion } from "./projectVersions";
import { forgetAllServersForTesting, noteAuthor, putSnapshot, takeAuthor } from "./snapshotMirror";

/**
 * Chaque Snapshot reçu qui diffère du précédent devient une Version (ADR
 * `snapshot-mirror-and-backend-history`, décision 6).
 */
const now = new Date("2026-09-27T00:00:00Z");
const snap = (hash: string, files: Record<string, string>) => ({
	hash,
	files: Object.entries(files).map(([path, content]) => ({ path, content })),
	binaries: [],
	failed: [],
});
const tick = () => new Promise((r) => setTimeout(r, 5));

beforeEach(async () => {
	forgetAllServersForTesting();
	await db.delete(snapshotBlobs);
	await db.delete(networks);
	await db.delete(users);
	await db.insert(users).values({ id: "alice", email: "a@t.com", name: "Alice", createdAt: now, updatedAt: now });
	await db.insert(networks).values({ id: "n", name: "N", createdAt: now, updatedAt: now });
	await db.insert(serverKeys).values({ id: "s", hash: "h", networkId: "n", createdAt: now });
	await db.insert(projects).values({ id: "p", name: "P", externalId: "shop", networkId: "n", serverKeyId: "s", createdAt: now, updatedAt: now });
});

test("un Snapshot identique au précédent ne crée pas de Version", async () => {
	await putSnapshot("p", snap("H1", { "menus/a.yaml": "a1" }));
	await putSnapshot("p", snap("H1", { "menus/a.yaml": "a1" }));
	await putSnapshot("p", snap("H2", { "menus/a.yaml": "a2" }));
	expect(await db.select().from(projectVersions)).toHaveLength(2);
});

test("l'auteur noté après une écriture signe la Version suivante, une seule fois", async () => {
	noteAuthor("s", "shop", "alice");
	expect(takeAuthor("s", "shop")).toBe("alice");
	expect(takeAuthor("s", "shop")).toBeNull();

	await putSnapshot("p", snap("H1", { "menus/a.yaml": "a1" }));
	await tick();
	await putSnapshot("p", snap("H2", { "menus/a.yaml": "a2" }), { authorId: "alice" });
	const versions = await listVersions("p");
	expect(versions.map((v) => [v.hash, v.author])).toEqual([["H2", { id: "alice", name: "Alice" }], ["H1", null]]);
	expect(versions[0]!.changed).toEqual(["menus/a.yaml"]);
});

test("une Version se relit en entier", async () => {
	await putSnapshot("p", snap("H1", { "menus/a.yaml": "a1", "lang/fr.yaml": "x" }));
	const [version] = await listVersions("p");
	const read = await readVersion("p", version!.id);
	expect(read?.files).toEqual([{ path: "lang/fr.yaml", content: "x" }, { path: "menus/a.yaml", content: "a1" }]);
	expect(await readVersion("autre", version!.id)).toBeNull();
});

test("l'historique d'un fichier rend ses contenus passés, le plus récent d'abord, sans l'actuel", async () => {
	await putSnapshot("p", snap("H1", { "menus/a.yaml": "a1", "menus/b.yaml": "b1" }));
	await tick();
	await putSnapshot("p", snap("H2", { "menus/a.yaml": "a1", "menus/b.yaml": "b2" }), { authorId: "alice" });
	await tick();
	await putSnapshot("p", snap("H3", { "menus/a.yaml": "a2", "menus/b.yaml": "b2" }));

	const history = await fileHistory("p", "menus/a.yaml");
	// a1 date de H1 (serveur), pas de H2 qui l'a seulement conservé.
	expect(history?.map((v) => [v.content, v.author?.name ?? null])).toEqual([["a1", null]]);
	const b = await fileHistory("p", "menus/b.yaml");
	expect(b?.map((v) => [v.content, v.author?.name ?? null])).toEqual([["b1", null]]);
});

test("aucune Version : l'historique rend null (on retombera sur le plugin)", async () => {
	expect(await fileHistory("p", "menus/a.yaml")).toBeNull();
});
