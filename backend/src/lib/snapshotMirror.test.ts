import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { networks, projects, projectSnapshots, serverKeys, snapshotBlobs } from "../db/schema";
import {
	announcedHash,
	listedProjects,
	confirmRead,
	forgetAllServersForTesting,
	forgetServer,
	generationOf,
	getSnapshot,
	markUnknown,
	mirrorSupported,
	putSnapshot,
	recordHello,
	recordReload,
} from "./snapshotMirror";

const now = new Date();
const snap = (hash: string, files: Record<string, string>) => ({
	hash,
	files: Object.entries(files).map(([path, content]) => ({ path, content })),
	binaries: [{ path: "assets/textures/a.png", hash: "bin", size: 3 }],
	failed: [{ path: "menus/broken.yaml", reason: "bad yaml" }],
});

describe("store", () => {
	beforeEach(async () => {
		await db.delete(snapshotBlobs);
		await db.delete(networks);
		await db.insert(networks).values({ id: "mirror-net", name: "Mirror", createdAt: now, updatedAt: now });
		await db.insert(serverKeys).values({ id: "mirror-srv", hash: "h", networkId: "mirror-net", createdAt: now });
		for (const id of ["p1", "p2"]) {
			await db.insert(projects).values({ id, name: id, externalId: id, networkId: "mirror-net", serverKeyId: "mirror-srv", createdAt: now, updatedAt: now });
		}
	});

	test("rend ce qui a été rangé, fichiers triés", async () => {
		await putSnapshot("p1", snap("H1", { "menus/b.yaml": "b", "menus/a.yaml": "a" }));
		expect(await getSnapshot("p1")).toEqual({
			hash: "H1",
			files: [{ path: "menus/a.yaml", content: "a" }, { path: "menus/b.yaml", content: "b" }],
			binaries: [{ path: "assets/textures/a.png", hash: "bin", size: 3 }],
			failed: [{ path: "menus/broken.yaml", reason: "bad yaml" }],
			receivedAt: expect.any(String),
		});
		expect(await getSnapshot("p2")).toBeNull();
	});

	test("un contenu partagé n'est stocké qu'une fois", async () => {
		await putSnapshot("p1", snap("H1", { "lang/fr.yaml": "same", "menus/a.yaml": "a" }));
		await putSnapshot("p2", snap("H2", { "lang/fr.yaml": "same" }));
		expect(await db.select().from(snapshotBlobs)).toHaveLength(2);
	});

	test("un nouveau Snapshot remplace l'ancien", async () => {
		await putSnapshot("p1", snap("H1", { "menus/a.yaml": "a" }));
		await putSnapshot("p1", snap("H2", { "menus/b.yaml": "b" }));
		const got = await getSnapshot("p1");
		expect(got?.hash).toBe("H2");
		expect(got?.files).toEqual([{ path: "menus/b.yaml", content: "b" }]);
	});

	test("supprimer le Project supprime son miroir", async () => {
		await putSnapshot("p1", snap("H1", { "menus/a.yaml": "a" }));
		await db.delete(projects).where(eq(projects.id, "p1"));
		expect(await db.select().from(projectSnapshots)).toHaveLength(0);
	});
});

describe("validité", () => {
	beforeEach(() => forgetAllServersForTesting());

	test("sans hello capable, rien n'est connu", () => {
		recordReload("s", [{ id: "shop", hash: "H1" }]);
		expect(mirrorSupported("s")).toBe(false);
		expect(announcedHash("s", "shop")).toBeUndefined();
	});

	test("hello puis reload fixent le hash annoncé", () => {
		recordHello("s", [{ id: "shop", hash: "H1" }]);
		expect(announcedHash("s", "shop")).toBe("H1");
		recordReload("s", [{ id: "shop", hash: "H2" }]);
		expect(announcedHash("s", "shop")).toBe("H2");
	});

	test("un nouveau hello repart de zéro", () => {
		recordHello("s", [{ id: "shop", hash: "H1" }, { id: "old", hash: "X" }]);
		recordHello("s", [{ id: "shop", hash: "H2" }]);
		expect(announcedHash("s", "old")).toBeUndefined();
	});

	test("une écriture rend le hash inconnu et périme les lectures en vol", () => {
		recordHello("s", [{ id: "shop", hash: "H1" }]);
		const before = generationOf("s", "shop");
		markUnknown("s", "shop");
		expect(announcedHash("s", "shop")).toBeUndefined();
		confirmRead("s", "shop", "H0", before);
		expect(announcedHash("s", "shop")).toBeUndefined();
		confirmRead("s", "shop", "H2", generationOf("s", "shop"));
		expect(announcedHash("s", "shop")).toBe("H2");
	});

	test("la déconnexion oublie tout", () => {
		recordHello("s", [{ id: "shop", hash: "H1" }]);
		forgetServer("s");
		expect(mirrorSupported("s")).toBe(false);
		expect(announcedHash("s", "shop")).toBeUndefined();
	});

	test("la liste suit le hello puis le reload, pas les écritures", () => {
		expect(listedProjects("s")).toBeNull();
		recordHello("s", [{ id: "shop", hash: "H1" }]);
		expect(listedProjects("s")).toEqual(["shop"]);
		recordReload("s", [{ id: "warps", hash: "W" }, { id: "shop", hash: "H2" }]);
		expect(listedProjects("s")).toEqual(["shop", "warps"]);
		markUnknown("s", "shop");
		expect(listedProjects("s")).toEqual(["shop", "warps"]);
		recordReload("s", [{ id: "warps", hash: "W" }]);
		expect(listedProjects("s")).toEqual(["warps"]);
	});
});
