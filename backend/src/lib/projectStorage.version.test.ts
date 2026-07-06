import { beforeEach, describe, expect, test } from "bun:test";
import { db } from "../db/index";
import { memberships, networks, projects, serverKeys, users, userSessions } from "../db/schema";
import { createNetwork } from "./networkManager";
import { createProject, getProject, upsertProjectContent } from "./projectStorage";

async function clearAll() {
	await db.delete(projects);
	await db.delete(serverKeys);
	await db.delete(memberships);
	await db.delete(networks);
	await db.delete(userSessions);
	await db.delete(users);
}

async function seedProject() {
	const network = await createNetwork("N");
	const keyId = crypto.randomUUID();
	await db.insert(serverKeys).values({
		id: keyId,
		hash: "h" + keyId.slice(0, 8),
		label: null,
		networkId: network.id,
		createdAt: new Date(),
	});
	return await createProject({ networkId: network.id, serverKeyId: keyId, name: "p" });
}

describe("projectStorage — version (optimistic concurrency)", () => {
	beforeEach(clearAll);

	test("fresh project starts at version 0", async () => {
		const p = await seedProject();
		expect(p.version).toBe(0);
	});

	test("upsertProjectContent without expectedVersion increments and returns new version", async () => {
		const p = await seedProject();
		const v1 = await upsertProjectContent(p.id, { hash: "h1", filesJson: "{}" });
		expect(v1).toBe(1);
		const v2 = await upsertProjectContent(p.id, { hash: "h2", filesJson: "{}" });
		expect(v2).toBe(2);
		const row = await getProject(p.id);
		expect(row?.version).toBe(2);
	});

	test("upsertProjectContent with matching expectedVersion succeeds", async () => {
		const p = await seedProject();
		const v1 = await upsertProjectContent(p.id, { hash: "h1", filesJson: "{}" }, { expectedVersion: 0 });
		expect(v1).toBe(1);
	});

	test("upsertProjectContent with stale expectedVersion returns null and leaves content untouched", async () => {
		const p = await seedProject();
		await upsertProjectContent(p.id, { hash: "h1", filesJson: '{"a":"1"}' });
		const result = await upsertProjectContent(
			p.id,
			{ hash: "h_stale", filesJson: '{"stale":"1"}' },
			{ expectedVersion: 0 },
		);
		expect(result).toBeNull();
		const row = await getProject(p.id);
		expect(row?.hash).toBe("h1");
		expect(row?.filesJson).toBe('{"a":"1"}');
		expect(row?.version).toBe(1);
	});

	test("upsertProjectContent on unknown project returns null", async () => {
		const result = await upsertProjectContent("pack_nope", { hash: "h" });
		expect(result).toBeNull();
	});
});
