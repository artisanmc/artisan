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
test("claim requires account, origin and CSRF; retains revoked proof for lost-response retry", async () => {
	const f = fixture();
	const headers = {
		Cookie: "artisan_demo_session=secret",
		Origin: "http://localhost:5173",
		"Content-Type": "application/json",
	};
	expect(
		(
			await f.app.request("/api/v1/demo/claim", {
				method: "POST",
				headers,
				body: "{}",
			})
		).status,
	).toBe(401);
	expect(
		(
			await f.app.request("/api/v1/demo/claim", {
				method: "POST",
				headers: { ...headers, "Test-Account": "yes" },
				body: "{}",
			})
		).status,
	).toBe(403);
	const r = await f.app.request("/api/v1/demo/claim", {
		method: "POST",
		headers: {
			...headers,
			"Test-Account": "yes",
			"X-Artisan-Demo-CSRF": "csrf",
		},
		body: JSON.stringify({ operationId: "claim", networkId: "network" }),
	});
	expect(r.status).toBe(200);
	expect(f.count().claims).toBe(1);
	expect(r.headers.get("Set-Cookie")).toBeNull();
	const retry = await f.app.request("/api/v1/demo/claim", {
		method: "POST",
		headers: {
			...headers,
			"Test-Account": "yes",
			"X-Artisan-Demo-CSRF": "csrf",
		},
		body: JSON.stringify({ operationId: "claim", networkId: "network" }),
	});
	expect(retry.status).toBe(200);
	expect(await retry.json()).toEqual(await r.json());
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
test("retry for an older project never claims the newer demo cookie project", async () => {
	let claims = 0;
	const resumed: unknown[] = [];
	const a = new Hono();
	a.use("*", async (c, next) => {
		c.set("user" as never, { id: "account" } as never);
		await next();
	});
	a.route(
		"/",
		createDemoRouter({
			read: async () => bootstrap,
			create: async () => bootstrap,
			proof: async () => ({ ...bootstrap, projectId: "new-demo" }),
			claim: async () => {
				claims++;
				return { projectId: "new-demo", networkId: "n" };
			},
			resume: async (user, input) => {
				resumed.push({ user, input });
				return { projectId: input.projectId, networkId: input.networkId };
			},
			rateKey: () => "test",
		}),
	);
	const r = await a.request("/claim", {
		method: "POST",
		headers: {
			Origin: "http://localhost:5173",
			Cookie: "artisan_demo_session=new",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			projectId: "old-demo",
			operationId: "old-op",
			networkId: "n",
		}),
	});
	expect(r.status).toBe(200);
	expect(claims).toBe(0);
	expect(resumed).toEqual([
		{
			user: "account",
			input: { projectId: "old-demo", operationId: "old-op", networkId: "n" },
		},
	]);
});
