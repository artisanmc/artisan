import { expect, test } from "bun:test";
import { Hono } from "hono";
import { createDemoRouter } from "./demo";

test('oversized demo request preserves framework413 beforecreation',async()=>{
 const f=fixture();const r=await f.app.request('/api/v1/demo',{method:'POST',headers:{Origin:'http://localhost:5173','Content-Type':'application/json'},body:JSON.stringify({large:'x'.repeat(3000)})});expect(r.status).toBe(413);expect(f.count().creates).toBe(0);
});

test("known expired recovery returns410 without creating a replacement", async () => {
	const a = createDemoRouter({
		read: async () => null,
		proof: async () => ({
			csrfToken: "csrf",
			projectId: "old",
			state: "expired",
		}),
		create: async () => {
			throw Error("must not create");
		},
		claim: async () => ({ projectId: "old", networkId: "n" }),
		rateKey: () => "test",
	});
	expect(
		(await a.request("/", { headers: { Cookie: "artisan_demo_session=old" } }))
			.status,
	).toBe(410);
});

const bootstrap = {
	token: "secret",
	csrfToken: "csrf",
	principal: { kind: "guest" as const, id: "guest", projectId: "demo" },
	projectId: "demo",
	expiresAt: "2026-09-14T00:00:00.000Z",
};
function fixture() {
	let creates = 0;
	let claims = 0;
	const router = createDemoRouter({
		read: async (token) => (token === "secret" ? bootstrap : null),
		create: async () => {
			creates++;
			return bootstrap;
		},
		proof: async (token) => (token === "secret" ? bootstrap : null),
		claim: async () => {
			claims++;
			return { projectId: "demo", networkId: "network" };
		},
		rateKey: () => "trusted-test-key",
	});
	const app = new Hono();
	app.use("*", async (c, next) => {
		c.set(
			"user" as never,
			c.req.header("Test-Account") ? { id: "account" } : (null as never),
		);
		await next();
	});
	app.route("/api/v1/demo", router);
	return { app, count: () => ({ creates, claims }) };
}
test("GET demo never creates; POST refuses cross-site bootstrap", async () => {
	const f = fixture();
	expect((await f.app.request("/api/v1/demo")).status).toBe(404);
	expect(
		(
			await f.app.request("/api/v1/demo", {
				method: "POST",
				headers: { Origin: "https://evil.invalid" },
			})
		).status,
	).toBe(403);
	expect(f.count().creates).toBe(0);
});
test("bootstrap returns opaque cookie and CSRF without bearer token in JSON", async () => {
	const f = fixture();
	const r = await f.app.request("/api/v1/demo", {
		method: "POST",
		headers: { Origin: "http://localhost:5173" },
	});
	expect(r.status).toBe(201);
	expect(r.headers.get("Set-Cookie")).toContain("HttpOnly");
	expect(r.headers.get("Set-Cookie")).toContain("SameSite=Lax");
	expect(await r.json()).toEqual({
		projectId: "demo",
		expiresAt: bootstrap.expiresAt,
		csrfToken: "csrf",
		principal: bootstrap.principal,
	});
});
test("GET recovery does not renew cookie and unknown failures are sanitized", async () => {
	const f = fixture();
	const recovered = await f.app.request("/api/v1/demo", {
		headers: { Cookie: "artisan_demo_session=secret" },
	});
	expect(recovered.status).toBe(200);
	expect(recovered.headers.get("Set-Cookie")).toBeNull();
	const app = createDemoRouter({
		read: async () => null,
		create: async () => {
			throw Error("internal filesystem detail");
		},
		proof: async () => null,
		claim: async () => ({ projectId: "p", networkId: "n" }),
		rateKey: () => "fixed",
	});
	const response = await app.request("/", {
		method: "POST",
		headers: { Origin: "http://localhost:5173" },
	});
	expect(response.status).toBe(503);
	expect(await response.json()).toEqual({ error: "storage_unavailable" });
});
