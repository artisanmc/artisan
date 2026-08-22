// backend/src/routes/userAssets.diskOnly.test.ts
// P6a (ADR `assets-on-server-disk`) : le disque du serveur est la SEULE source
// d'assets. Ce fichier verrouille ce que le repli sur la table masquait —
// notamment qu'un serveur muet doit se dire, et pas se lire comme un vide.
import { mock } from "bun:test";
mock.module("../lib/resourcePack", () => ({
	rebuildResourcePack: async () => ({ url: "stub://rp", hash: "stubbedHash" }),
	currentPackInfo: async () => null,
}));
import { clearFakeDisk, fakeHubModule, hashOf, diskText } from "../test/fakeServerDisk";

/** Le serveur répond, ou pas — chaque test le décide. */
const server = { online: true };
const realHub = fakeHubModule();
mock.module("../ws/hub", () =>
	fakeHubModule({
		requestProjectRead: async (...args: unknown[]) =>
			server.online
				? (realHub.requestProjectRead as (...a: unknown[]) => unknown)(...args)
				: { kind: "offline" },
	}),
);

import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { db } from "../db/index";
import {
	assets,
	linkCodes,
	memberships,
	networks,
	projects,
	serverKeys,
	userSessions,
	users,
} from "../db/schema";
import { userAssetsRouter } from "./userAssets";
import { userAuth } from "../middleware/userAuth";
import { createSession } from "../lib/sessionManager";
import { createNetwork } from "../lib/networkManager";
import { addMembership } from "../lib/membershipManager";
import { createProject } from "../lib/projectStorage";
import { generateServerKey } from "../lib/auth";

function makeApp() {
	const app = new Hono();
	app.use("/api/v1/user/projects/*", userAuth());
	app.route("/api/v1/user/projects", userAssetsRouter);
	return app;
}

async function clearAll() {
	clearFakeDisk();
	await db.delete(assets);
	await db.delete(projects);
	await db.delete(linkCodes);
	await db.delete(serverKeys);
	await db.delete(memberships);
	await db.delete(networks);
	await db.delete(userSessions);
	await db.delete(users);
}

async function seed() {
	const userId = "u_diskonly";
	await db.insert(users).values({
		id: userId,
		email: `${userId}@a.b`,
		name: userId,
		passwordHash: null,
		avatarUrl: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	const session = await createSession(userId);
	const network = await createNetwork("N");
	await addMembership(userId, network.id, "owner");
	const { id: skId, hash: skHash } = await generateServerKey();
	await db.insert(serverKeys).values({
		id: skId,
		hash: skHash,
		label: null,
		networkId: network.id,
		createdAt: new Date(),
	});
	const project = await createProject({ networkId: network.id, serverKeyId: skId, name: "p" });
	return { sessionId: session.id, projectId: project.id };
}

/** Une ligne d'asset en base — l'ancien monde, celui qui ne doit plus répondre. */
async function seedTableRow(projectId: string, name = "orpheline") {
	await db.insert(assets).values({
		id: "asset_orpheline",
		projectId,
		type: "texture",
		name,
		width: 1,
		height: 1,
		ascent: null,
		codepoint: null,
		contentWidth: null,
		fontMeta: null,
		contentHash: "deadbeef",
		createdAt: new Date(),
		updatedAt: new Date(),
	});
}

describe("assets : le disque est la seule source (P6a)", () => {
	beforeEach(async () => {
		server.online = true;
		await clearAll();
	});

	test("un serveur muet se dit, il ne se lit pas comme une bibliothèque vide", async () => {
		const { sessionId, projectId } = await seed();
		server.online = false;
		const res = await makeApp().request(`/api/v1/user/projects/${projectId}/assets`, {
			headers: { Cookie: `artisan_user_session=${sessionId}` },
		});
		expect(res.status).toBe(503);
		expect((await res.json()).error).toBe("server_offline");
	});

	test("un disque joignable et vide rend une liste vide, même si la table a gardé des lignes", async () => {
		const { sessionId, projectId } = await seed();
		await seedTableRow(projectId);
		const res = await makeApp().request(`/api/v1/user/projects/${projectId}/assets`, {
			headers: { Cookie: `artisan_user_session=${sessionId}` },
		});
		expect(res.status).toBe(200);
		expect((await res.json()).assets).toEqual([]);
	});

	test("lire un asset que seule la table connaît est un 404, pas une résurrection", async () => {
		const { sessionId, projectId } = await seed();
		await seedTableRow(projectId);
		const res = await makeApp().request(
			`/api/v1/user/projects/${projectId}/assets/asset_orpheline`,
			{ headers: { Cookie: `artisan_user_session=${sessionId}` } },
		);
		expect(res.status).toBe(404);
	});

	test("supprimer pendant que le serveur est muet ne supprime rien du tout", async () => {
		const { sessionId, projectId } = await seed();
		await seedTableRow(projectId);
		server.online = false;
		const res = await makeApp().request(
			`/api/v1/user/projects/${projectId}/assets/asset_orpheline`,
			{ method: "DELETE", headers: { Cookie: `artisan_user_session=${sessionId}` } },
		);
		expect(res.status).toBe(503);
		expect((await db.select().from(assets)).length).toBe(1);
	});

	test("éditer pendant que le serveur est muet répond hors ligne", async () => {
		const { sessionId, projectId } = await seed();
		await seedTableRow(projectId);
		server.online = false;
		const res = await makeApp().request(
			`/api/v1/user/projects/${projectId}/assets/asset_orpheline`,
			{
				method: "PATCH",
				headers: { Cookie: `artisan_user_session=${sessionId}`, "Content-Type": "application/json" },
				body: JSON.stringify({ name: "renommee" }),
			},
		);
		expect(res.status).toBe(503);
	});

	test("dupliquer pendant que le serveur est muet répond hors ligne", async () => {
		const { sessionId, projectId } = await seed();
		await seedTableRow(projectId);
		server.online = false;
		const res = await makeApp().request(
			`/api/v1/user/projects/${projectId}/assets/asset_orpheline/duplicate`,
			{ method: "POST", headers: { Cookie: `artisan_user_session=${sessionId}` } },
		);
		expect(res.status).toBe(503);
	});

	test("un disque lisible garde la main : l'asset du disque est celui qu'on lit", async () => {
		const { sessionId, projectId } = await seed();
		const png = new Uint8Array([1, 2, 3]);
		diskText.set(
			"assets/textures/logo.yaml",
			"schema: asset/v1\ntype: texture\nwidth: 1\nheight: 1\n",
		);
		const { diskBinary } = await import("../test/fakeServerDisk");
		diskBinary.set("assets/textures/logo.png", png);
		expect(hashOf(png)).toBeString();
		const res = await makeApp().request(`/api/v1/user/projects/${projectId}/assets`, {
			headers: { Cookie: `artisan_user_session=${sessionId}` },
		});
		expect(res.status).toBe(200);
		const names = (await res.json()).assets.map((a: { name: string }) => a.name);
		expect(names).toContain("logo");
	});
});
