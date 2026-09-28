import { afterEach, beforeEach, expect, test } from "bun:test";
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
beforeEach(async () => {
	await db.delete(projects).where(sql`${projects.id} LIKE 'demo_%'`);
	await db.delete(demoSessions);
});
afterEach(async () => {
	await db.delete(projects).where(sql`${projects.id} LIKE 'demo_%'`);
	await db.delete(demoSessions);
	Reflect.deleteProperty(process.env, "DEMO_MAX_BYTES");
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
	// La démo ne publie rien (ADR `server-only-projects`) : son travail va au brouillon.
	expect((await app.request(path, { method: "PUT", headers: h, body })).status).not.toBe(200);
	expect(await (await app.request(path, { headers: h })).json()).toEqual(before);
	const write = await app.request(`/api/v1/user/projects/${a.projectId}/drafts`, {
		method: "POST",
		headers: h,
		body: JSON.stringify({
			id: "http",
			operationId: "http-edit",
			name: "Work",
			snapshot: { baseline: {}, tree: { "http.yaml": "value: saved" }, at: 1 },
		}),
	});
	expect(write.status).toBe(201);
	expect(write.headers.get("X-Artisan-Demo-Expires-At")).not.toBeNull();
	expect(write.headers.get("Set-Cookie")).toContain("HttpOnly");
	const read = await app.request(`/api/v1/user/projects/${a.projectId}/drafts/http`, { headers: h });
	expect(read.headers.get("Set-Cookie")).toBeNull();
	expect((await read.json()).draft.snapshot.tree["http.yaml"]).toBe("value: saved");
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
		// « Copier vers un serveur » est retiré (ADR `server-only-projects`).
	).toBe(404);
});
test("quota rejection returns a safe actionable code and keeps no draft", async () => {
	const s = await createDemoSession({ rateKey: "http-quota" });
	const h = headers(s);
	const path = `/api/v1/user/projects/${s.projectId}/drafts`;
	process.env.DEMO_MAX_BYTES = "100";
	const r = await app.request(path, {
		method: "POST",
		headers: h,
		body: JSON.stringify({
			id: "large",
			operationId: "quota",
			name: "Work",
			snapshot: { baseline: {}, tree: { "large.yaml": "x".repeat(1000) }, at: 1 },
		}),
	});
	expect(r.status).toBe(413);
	expect(await r.json()).toEqual({ error: "demo_quota_exceeded" });
	Reflect.deleteProperty(process.env, "DEMO_MAX_BYTES");
	expect((await (await app.request(path, { headers: h })).json()).drafts).toEqual([]);
});
