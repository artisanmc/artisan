import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { app } from "../app";
import { db } from "../db";
import {
	demoSessions,
	memberships,
	networks,
	projects,
	users,
} from "../db/schema";
import { createDemoSession } from "../lib/demoSessions";
import { createSession } from "../lib/sessionManager";
let directory: string;
let previous: string | undefined;
beforeEach(async () => {
	previous = process.env.HOSTED_PROJECTS_DIR;
	directory = await mkdtemp(join(tmpdir(), "artisan-demo-http-"));
	process.env.HOSTED_PROJECTS_DIR = directory;
	await db.delete(projects).where(sql`${projects.id} LIKE 'demo_%'`);
	await db.delete(demoSessions);
});
afterEach(async () => {
	await db.delete(projects).where(sql`${projects.id} LIKE 'demo_%'`);
	await db.delete(demoSessions);
	if (previous === undefined)
		Reflect.deleteProperty(process.env, "HOSTED_PROJECTS_DIR");
	else process.env.HOSTED_PROJECTS_DIR = previous;
	Reflect.deleteProperty(process.env, "DEMO_MAX_BYTES");
	await rm(directory, { recursive: true, force: true });
});
const headers = (s: Awaited<ReturnType<typeof createDemoSession>>) => ({
	Cookie: `artisan_demo_session=${s.token}`,
	Origin: "http://localhost:5173",
	"Content-Type": "application/json",
	"X-Artisan-Demo-CSRF": s.csrfToken,
});
test("HTTP guest draft owner stays aligned across repeated saves and refresh", async () => {
	const session = await createDemoSession({ rateKey: "http-repeat" });
	const path = `/api/v1/user/projects/${session.projectId}/drafts`;
	const snapshot = { baseline: {}, tree: { "menu.yaml": "name: one" }, at: 1 };
	const created = await app.request(path, {
		method: "POST",
		headers: headers(session),
		body: JSON.stringify({
			id: "repeat",
			operationId: "create",
			name: "Work",
			snapshot,
		}),
	});
	expect(created.status).toBe(201);
	expect((await created.json()).draft).toMatchObject({
		ownerId: session.principal.id,
		revision: 1,
	});
	for (const revision of [1, 2]) {
		const saved = await app.request(`${path}/repeat`, {
			method: "PUT",
			headers: headers(session),
			body: JSON.stringify({
				revision,
				operationId: `save-${revision}`,
				name: "Work",
				snapshot: {
					...snapshot,
					tree: { "menu.yaml": `name: save-${revision}` },
				},
			}),
		});
		expect(saved.status).toBe(200);
		expect((await saved.json()).draft).toMatchObject({
			ownerId: session.principal.id,
			revision: revision + 1,
		});
	}
	const refreshed = await app.request(`${path}/repeat`, {
		headers: headers(session),
	});
	expect((await refreshed.json()).draft).toMatchObject({
		ownerId: session.principal.id,
		revision: 3,
		snapshot: { tree: { "menu.yaml": "name: save-2" } },
	});
});
test("real guest routes isolate projects, assets and drafts and reject CSRF before writes", async () => {
	const a = await createDemoSession({ rateKey: "http-a" });
	const b = await createDemoSession({ rateKey: "http-b" });
	const h = headers(a);
	expect(
		(
			await app.request(`/api/v1/user/projects/${a.projectId}/assets`, {
				headers: h,
			})
		).status,
	).toBe(200);
	for (const path of [
		`/projects/${b.projectId}/files`,
		`/projects/${b.projectId}/binary?path=assets/a.png`,
		`/user/projects/${b.projectId}/drafts`,
		`/textures/asset/${b.projectId}/a`,
		`/user/projects/${b.projectId}`,
	])
		expect([403, 404]).toContain(
			(await app.request(`/api/v1${path}`, { headers: h })).status,
		);
	const path = `/api/v1/projects/${a.projectId}/files`;
	const before = await (await app.request(path, { headers: h })).json();
	const body = JSON.stringify({
		operationId: "http-edit",
		files: [{ path: "http.yaml", content: "value: saved", base_hash: null }],
	});
	expect(
		(
			await app.request(path, {
				method: "PUT",
				headers: { ...h, Origin: "https://evil.invalid" },
				body,
			})
		).status,
	).toBe(403);
	expect(
		(
			await app.request(path, {
				method: "PUT",
				headers: { ...h, "X-Artisan-Demo-CSRF": "" },
				body,
			})
		).status,
	).toBe(403);
	expect(await (await app.request(path, { headers: h })).json()).toEqual(
		before,
	);
	const write = await app.request(path, { method: "PUT", headers: h, body });
	expect(write.status).toBe(200);
	expect(write.headers.get("X-Artisan-Demo-Expires-At")).not.toBeNull();
	expect(write.headers.get("Set-Cookie")).toContain("HttpOnly");
	const read = await app.request(path, { headers: h });
	expect(read.headers.get("Set-Cookie")).toBeNull();
	expect((await read.json()).files).toContainEqual({
		path: "http.yaml",
		content: "value: saved",
	});
	const meta = await (
		await app.request(`/api/v1/user/projects/${a.projectId}`, { headers: h })
	).json();
	expect(meta.networkId).toBeNull();
	expect(meta.capabilities.canCopyToServer).toBe(false);
	expect(
		(
			await app.request(`/api/v1/user/projects/${a.projectId}/copy-targets`, {
				headers: h,
			})
		).status,
	).toBe(401);
});
test("account cookie cannot authorize unclaimed demo by ID; exact guest proof survives OAuth then claims", async () => {
	const s = await createDemoSession({ rateKey: "http-account" });
	const id = `http-${crypto.randomUUID()}`;
	const now = new Date();
	await db.insert(users).values({
		id,
		name: "HTTP fixture",
		email: `${id}@test.invalid`,
		createdAt: now,
		updatedAt: now,
	});
	await db
		.insert(networks)
		.values({ id, name: "HTTP fixture", createdAt: now, updatedAt: now });
	await db
		.insert(memberships)
		.values({ id, userId: id, networkId: id, role: "owner", createdAt: now });
	const account = await createSession(id);
	const cookie = `artisan_user_session=${account.id}`;
	expect(
		(
			await app.request(`/api/v1/projects/${s.projectId}/files`, {
				headers: { Cookie: cookie },
			})
		).status,
	).toBe(403);
	const h = { ...headers(s), Cookie: `${headers(s).Cookie}; ${cookie}` };
	expect(
		(await app.request(`/api/v1/projects/${s.projectId}/files`, { headers: h }))
			.status,
	).toBe(200);
	const body = JSON.stringify({
		operationId: "claim-http",
		networkId: id,
		projectId: s.projectId,
	});
	const claim = await app.request("/api/v1/demo/claim", {
		method: "POST",
		headers: h,
		body,
	});
	expect(claim.status).toBe(200);
	expect(claim.headers.get("Set-Cookie")).toBeNull();
	expect(
		(
			await app.request(`/api/v1/projects/${s.projectId}/files`, {
				headers: headers(s),
			})
		).status,
	).toBe(403);
	expect(
		(await app.request(`/api/v1/projects/${s.projectId}/files`, { headers: h }))
			.status,
	).toBe(200);
	const replay = await app.request("/api/v1/demo/claim", {
		method: "POST",
		headers: { ...h, Cookie: cookie },
		body,
	});
	expect(replay.status).toBe(200);
	expect(await replay.json()).toEqual(await claim.json());
	await db.delete(networks).where(eq(networks.id, id));
	await db.delete(users).where(eq(users.id, id));
});
test("quota rejection returns a safe actionable code and keeps the prior tree", async () => {
	const s = await createDemoSession({ rateKey: "http-quota" });
	const h = headers(s);
	const path = `/api/v1/projects/${s.projectId}/files`;
	const before = await (await app.request(path, { headers: h })).json();
	process.env.DEMO_MAX_BYTES = "100";
	const r = await app.request(path, {
		method: "PUT",
		headers: h,
		body: JSON.stringify({
			operationId: "quota",
			files: [
				{ path: "large.yaml", content: "x".repeat(1000), base_hash: null },
			],
		}),
	});
	expect(r.status).toBe(413);
	expect(await r.json()).toEqual({ error: "demo_quota_exceeded" });
	Reflect.deleteProperty(process.env, "DEMO_MAX_BYTES");
	expect(await (await app.request(path, { headers: h })).json()).toEqual(
		before,
	);
});
