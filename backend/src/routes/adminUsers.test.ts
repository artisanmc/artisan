import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { app } from "../app";
import { db } from "../db/index";
import { memberships, networks, users } from "../db/schema";
import { createNetwork } from "../lib/networkManager";
import { createSession } from "../lib/sessionManager";

// Distinctive marker so list/search assertions never collide with rows
// seeded by other test files (the test DB is shared across the suite).
const MARK = "admuserstest";
const ADMIN_ID = `user_admin_${MARK}`;
const PLAIN_ID = `user_plain_${MARK}`;
const OTHER_ID = `user_other_${MARK}`;
let adminSession = "";
let plainSession = "";
let networkId = "";

beforeAll(async () => {
	const now = new Date();
	await db
		.insert(users)
		.values([
			{
				id: ADMIN_ID,
				email: `admin-${MARK}@example.com`,
				name: `Admin ${MARK}`,
				isAdmin: true,
				createdAt: now,
				updatedAt: now,
			},
			{
				id: PLAIN_ID,
				email: `plain-${MARK}@example.com`,
				name: `Plain ${MARK}`,
				passwordHash: "x",
				createdAt: now,
				updatedAt: now,
			},
			{
				id: OTHER_ID,
				email: `other-${MARK}@example.com`,
				name: `Zebra ${MARK}`,
				createdAt: now,
				updatedAt: now,
			},
		])
		.onConflictDoNothing();
	adminSession = (await createSession(ADMIN_ID)).id;
	plainSession = (await createSession(PLAIN_ID)).id;

	const network = await createNetwork(`net-${MARK}`);
	networkId = network.id;
	await db.insert(memberships).values({
		id: `mem_${MARK}`,
		userId: PLAIN_ID,
		networkId,
		role: "owner",
		createdAt: now,
	});
});

afterAll(async () => {
	if (networkId) await db.delete(networks).where(eq(networks.id, networkId));
	for (const id of [ADMIN_ID, PLAIN_ID, OTHER_ID])
		await db.delete(users).where(eq(users.id, id));
});

const adminHeaders = () => ({
	Cookie: `artisan_user_session=${adminSession}`,
	"Content-Type": "application/json",
});

describe("admin users endpoints", () => {
	it("403 without an admin session", async () => {
		const anon = await app.request("/api/v1/admin/users");
		expect(anon.status).toBe(403);
		const plain = await app.request("/api/v1/admin/users", {
			headers: { Cookie: `artisan_user_session=${plainSession}` },
		});
		expect(plain.status).toBe(403);
	});

	it("lists users without ever exposing password hashes", async () => {
		const res = await app.request(`/api/v1/admin/users?q=${MARK}`, {
			headers: adminHeaders(),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.users.length).toBe(3);
		expect(JSON.stringify(body)).not.toContain("passwordHash");
		const plain = body.users.find((u: { id: string }) => u.id === PLAIN_ID);
		expect(plain.email).toBe(`plain-${MARK}@example.com`);
		expect(plain.name).toBe(`Plain ${MARK}`);
		expect(plain.isAdmin).toBe(false);
		expect(plain.hasPassword).toBe(true);
		const other = body.users.find((u: { id: string }) => u.id === OTHER_ID);
		expect(other.hasPassword).toBe(false);
	});

	it("searches by name or email, case-insensitive", async () => {
		const byName = await app.request(`/api/v1/admin/users?q=zEbRa%20${MARK}`, {
			headers: adminHeaders(),
		});
		const byNameBody = await byName.json();
		expect(byNameBody.users.length).toBe(1);
		expect(byNameBody.users[0].id).toBe(OTHER_ID);

		const byEmail = await app.request(
			`/api/v1/admin/users?q=PLAIN-${MARK}@`,
			{ headers: adminHeaders() },
		);
		const byEmailBody = await byEmail.json();
		expect(byEmailBody.users.length).toBe(1);
		expect(byEmailBody.users[0].id).toBe(PLAIN_ID);
	});

	it("returns one user's profile with their networks", async () => {
		const res = await app.request(`/api/v1/admin/users/${PLAIN_ID}`, {
			headers: adminHeaders(),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.id).toBe(PLAIN_ID);
		expect(body.email).toBe(`plain-${MARK}@example.com`);
		expect(body.networks.length).toBe(1);
		expect(body.networks[0].id).toBe(networkId);
		expect(body.networks[0].role).toBe("owner");
		expect(JSON.stringify(body)).not.toContain("passwordHash");
	});

	it("404 for an unknown user id", async () => {
		const res = await app.request("/api/v1/admin/users/usr_nope", {
			headers: adminHeaders(),
		});
		expect(res.status).toBe(404);
	});

	it("PATCH edits name, email and isAdmin", async () => {
		const res = await app.request(`/api/v1/admin/users/${OTHER_ID}`, {
			method: "PATCH",
			headers: adminHeaders(),
			body: JSON.stringify({
				name: `Renamed ${MARK}`,
				email: `Renamed-${MARK}@Example.com`,
				isAdmin: true,
			}),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.name).toBe(`Renamed ${MARK}`);
		expect(body.email).toBe(`renamed-${MARK}@example.com`); // normalized
		expect(body.isAdmin).toBe(true);

		// Persisted, not just echoed.
		const get = await app.request(`/api/v1/admin/users/${OTHER_ID}`, {
			headers: adminHeaders(),
		});
		const fetched = await get.json();
		expect(fetched.name).toBe(`Renamed ${MARK}`);
		expect(fetched.isAdmin).toBe(true);

		// Revert the admin flag so later assertions stay predictable.
		await app.request(`/api/v1/admin/users/${OTHER_ID}`, {
			method: "PATCH",
			headers: adminHeaders(),
			body: JSON.stringify({ isAdmin: false }),
		});
	});

	it("422 on an invalid email, 409 on a taken email", async () => {
		const invalid = await app.request(`/api/v1/admin/users/${OTHER_ID}`, {
			method: "PATCH",
			headers: adminHeaders(),
			body: JSON.stringify({ email: "not-an-email" }),
		});
		expect(invalid.status).toBe(422);
		expect((await invalid.json()).error).toBe("invalid_email");

		const taken = await app.request(`/api/v1/admin/users/${OTHER_ID}`, {
			method: "PATCH",
			headers: adminHeaders(),
			body: JSON.stringify({ email: `plain-${MARK}@example.com` }),
		});
		expect(taken.status).toBe(409);
		expect((await taken.json()).error).toBe("email_taken");
	});

	it("422 on an empty name", async () => {
		const res = await app.request(`/api/v1/admin/users/${OTHER_ID}`, {
			method: "PATCH",
			headers: adminHeaders(),
			body: JSON.stringify({ name: "   " }),
		});
		expect(res.status).toBe(422);
		expect((await res.json()).error).toBe("invalid_name");
	});

	it("an admin cannot remove their own admin flag", async () => {
		const res = await app.request(`/api/v1/admin/users/${ADMIN_ID}`, {
			method: "PATCH",
			headers: adminHeaders(),
			body: JSON.stringify({ isAdmin: false }),
		});
		expect(res.status).toBe(422);
		expect((await res.json()).error).toBe("cannot_demote_self");
	});
});
