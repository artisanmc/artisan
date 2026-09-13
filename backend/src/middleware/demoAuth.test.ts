import { expect, test } from "bun:test";
import { Hono } from "hono";
import { requestProjectPrincipal } from "./demoAuth";
const demo = {
	token: "secret",
	csrfToken: "csrf",
	projectId: "demo",
	principal: { kind: "guest" as const, id: "g", projectId: "demo" },
	expiresAt: "2026-09-14T00:00:00.000Z",
};
function app() {
	const a = new Hono();
	a.all("/:id", async (c) => {
		c.set(
			"user" as never,
			c.req.header("Account") ? { id: "account" } : (null as never),
		);
		try {
			return c.json({
				principal: await requestProjectPrincipal(c, c.req.param("id"), {
					read: async (token) => (token === "secret" ? demo : null),
					proof: async () => null,
				}),
			});
		} catch (e) {
			const error = e as { code: string; status: 401 };
			return c.json({ error: error.code }, error.status);
		}
	});
	return a;
}
test("OAuth retains exact demo principal; other projects use only account authority", async () => {
	const a = app();
	const headers = { Cookie: "artisan_demo_session=secret", Account: "yes" };
	expect(await (await a.request("/demo", { headers })).json()).toEqual({
		principal: demo.principal,
	});
	expect(await (await a.request("/other", { headers })).json()).toEqual({
		principal: "account",
	});
	expect(
		(await a.request("/other", { headers: { Cookie: headers.Cookie } })).status,
	).toBe(403);
});
test("guest mutation requires matching Origin and CSRF before storage", async () => {
	const a = app();
	const headers = { Cookie: "artisan_demo_session=secret" };
	expect((await a.request("/demo", { method: "PUT", headers })).status).toBe(
		403,
	);
	expect(
		(
			await a.request("/demo", {
				method: "PUT",
				headers: {
					...headers,
					Origin: "https://evil.invalid",
					"X-Artisan-Demo-CSRF": "csrf",
				},
			})
		).status,
	).toBe(403);
	expect(
		(
			await a.request("/demo", {
				method: "PUT",
				headers: {
					...headers,
					Origin: "http://localhost:5173",
					"X-Artisan-Demo-CSRF": "csrf",
				},
			})
		).status,
	).toBe(200);
});
