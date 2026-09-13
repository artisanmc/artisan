import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
	deletedDraftOwners,
	demoSessions,
	memberships,
	networks,
	projects,
	users,
} from "../db/schema";
import {
	claimDemoSession,
	createDemoSession,
	maintainDemoSessions,
	openDemoProjectStorage,
	readDemoSession,
	resumeOwnedDemoClaim,
} from "./demoSessions";
import {
	HostedProjectStorage,
	hostedStorageOptions,
} from "./storage/HostedProjectStorage";
import { createHostedProject } from "./storage/hostedProjects";
let directory: string;
let previous: string | undefined;
beforeEach(async () => {
	previous = process.env.HOSTED_PROJECTS_DIR;
	directory = await mkdtemp(join(tmpdir(), "artisan-demo-test-"));
	process.env.HOSTED_PROJECTS_DIR = directory;
	await db.delete(projects).where(sql`${projects.id} LIKE 'demo_%'`);
	await db.delete(demoSessions);
});
afterEach(async () => {
	await db.delete(projects).where(sql`${projects.id} LIKE 'demo_%'`);
	await db.delete(demoSessions);
	if (previous === undefined) process.env.HOSTED_PROJECTS_DIR = undefined;
	else process.env.HOSTED_PROJECTS_DIR = previous;
	await rm(directory, { recursive: true, force: true });
	for (const key of [
		"DEMO_MAX_BYTES",
		"DEMO_MAX_FILES",
		"DEMO_GLOBAL_MAX_BYTES",
		"DEMO_CREATIONS_PER_HOUR",
		"DEMO_MUTATIONS_PER_MINUTE",
	])
		delete process.env[key];
});
async function seedOwner(userId = `user-${crypto.randomUUID()}`) {
	const networkId = `net-${crypto.randomUUID()}`;
	const now = new Date();
	await db
		.insert(users)
		.values({
			id: userId,
			email: `${userId}@example.test`,
			name: "Owner",
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoNothing();
	await db
		.insert(networks)
		.values({ id: networkId, name: "Claim", createdAt: now, updatedAt: now });
	const membershipId = crypto.randomUUID();
	await db.insert(memberships).values({
		id: membershipId,
		networkId,
		userId,
		role: "owner",
		createdAt: now,
	});
	return { userId, networkId, membershipId };
}
test("claim restart recovers owner remap and cookie-free authenticated proof", async () => {
	const session = await createDemoSession({ rateKey: "crash" });
	const storage = await openDemoProjectStorage(
		session.principal,
		await projectOf(session.projectId),
	);
	await storage.drafts.create("draft", "create", {
		name: "Saved",
		snapshot: { tree: { "sample.yaml": "hello" }, baseline: {}, at: 1 },
	});
	const { userId, networkId } = await seedOwner();
	let failure: unknown;
	try {
		await claimDemoSession(
			session.token,
			userId,
			{ operationId: "claim", networkId },
			async (step) => {
				if (step === "owner_remapped") throw new Error("crash");
			},
		);
	} catch (error) {
		failure = error;
	}
	expect(failure).toBeInstanceOf(Error);
	expect(await readDemoSession(session.token)).toBeNull();
	const result = await resumeOwnedDemoClaim(userId, {
		projectId: session.projectId,
		operationId: "claim",
		networkId,
	});
	expect(result.projectId).toBe(session.projectId);
	const claimed = await HostedProjectStorage.open(
		hostedStorageOptions(await projectOf(session.projectId), userId),
	);
	const draft = await claimed.drafts.read("draft");
	expect(draft.kind === "result" && draft.result.draft).toMatchObject({
		ownerId: userId,
		revision: 1,
	});
});
test("expiry revocation survives a crash after physical purge and cleanup retries", async () => {
	const session = await createDemoSession({ rateKey: "purge" });
	await db
		.update(demoSessions)
		.set({ lastActivityAt: new Date(1), expiresAt: new Date(1) })
		.where(eq(demoSessions.id, session.principal.id));
	const errors = await maintainDemoSessions(async () => {
		throw new Error("crash after purge");
	});
	expect(errors).toHaveLength(1);
	expect(
		(
			await db
				.select()
				.from(demoSessions)
				.where(eq(demoSessions.id, session.principal.id))
		)[0]?.state,
	).toBe("expired");
	expect(await readDemoSession(session.token)).toBeNull();
	expect(await maintainDemoSessions()).toEqual([]);
});
test("expired metadata is retained briefly then purged after physical cleanup despite a crash", async () => {
	const session = await createDemoSession({ rateKey: "metadata-purge" });
	await db
		.update(demoSessions)
		.set({ state: "expired" })
		.where(eq(demoSessions.id, session.principal.id));
	await db
		.update(projects)
		.set({ deletedAt: new Date() })
		.where(eq(projects.id, session.projectId));
	await maintainDemoSessions();
	expect(
		await db
			.select()
			.from(demoSessions)
			.where(eq(demoSessions.id, session.principal.id)),
	).toHaveLength(1);
	await db
		.update(projects)
		.set({ deletedAt: new Date(Date.now() - 86_400_001) })
		.where(eq(projects.id, session.projectId));
	const errors = await maintainDemoSessions(async () => {
		throw new Error("crash before metadata commit");
	});
	expect(errors).toHaveLength(1);
	expect(
		await db
			.select()
			.from(demoSessions)
			.where(eq(demoSessions.id, session.principal.id)),
	).toHaveLength(1);
	expect(await maintainDemoSessions()).toEqual([]);
	expect(
		await db
			.select()
			.from(demoSessions)
			.where(eq(demoSessions.id, session.principal.id)),
	).toHaveLength(0);
	expect(
		await db.select().from(projects).where(eq(projects.id, session.projectId)),
	).toHaveLength(0);
});
test("claim allocates a free folder without overwriting a colliding hosted project", async () => {
	const session = await createDemoSession({ rateKey: "collision" });
	const { userId, networkId } = await seedOwner();
	const occupied = await createHostedProject({
		networkId,
		ownerId: userId,
		folderName: `demo-${session.projectId.slice(5)}`,
		operationId: "existing",
		minecraftVersion: "1.21.4",
	});
	await claimDemoSession(session.token, userId, {
		operationId: "claim",
		networkId,
	});
	expect((await projectOf(session.projectId)).externalId).toBe(
		`${occupied.externalId}-2`,
	);
	expect((await projectOf(occupied.id)).externalId).toBe(occupied.externalId);
});
test("account deletion tombstone purges its protected pending claim", async () => {
	const session = await createDemoSession({ rateKey: "account-deleted" });
	const { userId, networkId } = await seedOwner();
	try {
		await claimDemoSession(
			session.token,
			userId,
			{ operationId: "claim", networkId },
			async (step) => {
				if (step === "intent") throw new Error("crash");
			},
		);
	} catch {}
	await db
		.insert(deletedDraftOwners)
		.values({ ownerId: userId, deletedAt: new Date() });
	await maintainDemoSessions();
	expect((await projectOf(session.projectId)).deletedAt).not.toBeNull();
	expect(
		(
			await db
				.select()
				.from(demoSessions)
				.where(eq(demoSessions.id, session.principal.id))
		)[0]?.state,
	).toBe("expired");
});
test("blocked claim is protected from TTL and only its owner may select another authorized target", async () => {
	const session = await createDemoSession({ rateKey: "blocked" });
	const first = await seedOwner();
	const second = await seedOwner(first.userId);
	try {
		await claimDemoSession(
			session.token,
			first.userId,
			{ operationId: "first", networkId: first.networkId },
			async (step) => {
				if (step === "intent") throw new Error("crash");
			},
		);
	} catch {}
	await db.delete(memberships).where(eq(memberships.id, first.membershipId));
	await db
		.update(demoSessions)
		.set({ lastActivityAt: new Date(1), expiresAt: new Date(1) })
		.where(eq(demoSessions.id, session.principal.id));
	await maintainDemoSessions();
	expect((await projectOf(session.projectId)).deletedAt).toBeNull();
	const claimed = await resumeOwnedDemoClaim(first.userId, {
		projectId: session.projectId,
		operationId: "second",
		networkId: second.networkId,
	});
	expect(claimed.networkId).toBe(second.networkId);
	let superseded: unknown;
	try {
		await resumeOwnedDemoClaim(first.userId, {
			projectId: session.projectId,
			operationId: "first",
			networkId: first.networkId,
		});
	} catch (error) {
		superseded = error;
	}
	expect(superseded).toMatchObject({ code: "operation_superseded" });
});
test("claimed root no longer consumes guest capacity and mutation rate is shared across reopened storage", async () => {
	const session = await createDemoSession({ rateKey: "rate" });
	const storage = await openDemoProjectStorage(
		session.principal,
		await projectOf(session.projectId),
	);
	process.env.DEMO_MUTATIONS_PER_MINUTE = "1";
	await storage.write({
		operationId: "first",
		files: [{ path: "first.yaml", content: "hello", base_hash: null }],
	});
	const reopened = await openDemoProjectStorage(
		session.principal,
		await projectOf(session.projectId),
	);
	let limited: unknown;
	try {
		await reopened.write({
			operationId: "second",
			files: [{ path: "second.yaml", content: "hello", base_hash: null }],
		});
	} catch (error) {
		limited = error;
	}
	expect(limited).toMatchObject({ code: "demo_rate_limited" });
	const { userId, networkId } = await seedOwner();
	await claimDemoSession(session.token, userId, {
		operationId: "claim",
		networkId,
	});
	const claimed = await HostedProjectStorage.open(
		hostedStorageOptions(await projectOf(session.projectId), userId),
	);
	await claimed.write({
		files: [
			{ path: "large.yaml", content: "x".repeat(100_000), base_hash: null },
		],
	});
	process.env.DEMO_GLOBAL_MAX_BYTES = "50000";
	expect((await createDemoSession({ rateKey: "new" })).projectId).not.toBe(
		session.projectId,
	);
});
test("several concurrent demo creations and writes complete without sharing project content", async () => {
	const sessions = await Promise.all(
		Array.from({ length: 4 }, () =>
			createDemoSession({ rateKey: crypto.randomUUID() }),
		),
	);
	await Promise.all(
		sessions.map(async (session) => {
			const storage = await openDemoProjectStorage(
				session.principal,
				await projectOf(session.projectId),
			);
			await storage.write({
				files: [
					{ path: "unique.yaml", content: session.projectId, base_hash: null },
				],
			});
			const result = await storage.read();
			expect(
				result.kind === "result" &&
					"files" in result.result &&
					result.result.files.find((f) => f.path === "unique.yaml")?.content,
			).toBe(session.projectId);
		}),
	);
});
const projectOf = async (id: string) =>
	(await db.select().from(projects).where(eq(projects.id, id)))[0]!;
test("reads and idempotent retries never renew inactivity but a new edit does", async () => {
	const initial = Date.now();
	const session = await createDemoSession({ rateKey: "activity" });
	await db
		.update(demoSessions)
		.set({ lastActivityAt: new Date(initial - 3600_000) })
		.where(eq(demoSessions.id, session.principal.id));
	const storage = await openDemoProjectStorage(
		session.principal,
		await projectOf(session.projectId),
	);
	const original = (await readDemoSession(session.token))?.expiresAt;
	await storage.read();
	expect((await readDemoSession(session.token))?.expiresAt).toBe(original);
	const edit = {
		operationId: "write",
		files: [
			{ path: "lang/new.yaml", content: "welcome: Hello", base_hash: null },
		],
	};
	await storage.write(edit);
	const renewed = (await readDemoSession(session.token))?.expiresAt;
	if (!renewed || !original) throw new Error("missing_demo_expiry");
	expect(new Date(renewed).getTime()).toBeGreaterThan(
		new Date(original).getTime(),
	);
	await storage.write(edit);
	expect((await readDemoSession(session.token))?.expiresAt).toBe(renewed);
	const raw = await HostedProjectStorage.open(
		hostedStorageOptions(await projectOf(session.projectId), "maintenance"),
	);
	await raw.filesystem.locked(async () => {
		const current = await raw.filesystem.current();
		await raw.filesystem.commit(current, async (next) => {
			next.state.demoActivityAt = 1;
		});
	});
	await db
		.update(demoSessions)
		.set({ lastActivityAt: new Date(1) })
		.where(eq(demoSessions.id, session.principal.id));
	expect(await readDemoSession(session.token)).toBeNull();
	let expired: unknown;
	try {
		await storage.read();
	} catch (error) {
		expired = error;
	}
	expect(expired).toMatchObject({ code: "demo_expired" });
	await maintainDemoSessions();
	expect((await projectOf(session.projectId)).deletedAt).not.toBeNull();
});
test("quota failures keep confirmed files and expiry while private drafts count", async () => {
	const session = await createDemoSession({ rateKey: "quota" });
	const storage = await openDemoProjectStorage(
		session.principal,
		await projectOf(session.projectId),
	);
	const before = await storage.read();
	process.env.DEMO_MAX_BYTES = "2048";
	await expect(
		storage.drafts.create("draft", "draft-write", {
			name: "Private",
			snapshot: {
				tree: { "large.yaml": "x".repeat(3000) },
				baseline: {},
				at: 1,
			},
		}),
	).rejects.toThrow("demo_quota_exceeded");
	expect(await storage.read()).toEqual(before);
	expect((await readDemoSession(session.token))?.expiresAt).toBe(
		session.expiresAt,
	);
});
test("global capacity and creation rate are shared by session instances", async () => {
	process.env.DEMO_CREATIONS_PER_HOUR = "1";
	await createDemoSession({ rateKey: "same-client" });
	await expect(createDemoSession({ rateKey: "same-client" })).rejects.toThrow(
		"demo_rate_limited",
	);
	process.env.DEMO_GLOBAL_MAX_BYTES = "1";
	await expect(createDemoSession({ rateKey: "other-client" })).rejects.toThrow(
		"demo_capacity_exceeded",
	);
});
test("claim preserves project, draft revision and bytes and revokes the guest idempotently", async () => {
	const session = await createDemoSession({ rateKey: "claim" });
	const storage = await openDemoProjectStorage(
		session.principal,
		await projectOf(session.projectId),
	);
	await storage.drafts.create("draft", "create-draft", {
		name: "My work",
		snapshot: { tree: { "menu.yaml": "name: Demo" }, baseline: {}, at: 1 },
	});
	const userId = `user-${crypto.randomUUID()}`;
	const networkId = `net-${crypto.randomUUID()}`;
	const now = new Date();
	await db.insert(users).values({
		id: userId,
		email: `${userId}@example.test`,
		name: "Owner",
		createdAt: now,
		updatedAt: now,
	});
	await db
		.insert(networks)
		.values({ id: networkId, name: "Claim", createdAt: now, updatedAt: now });
	await db.insert(memberships).values({
		id: crypto.randomUUID(),
		networkId,
		userId,
		role: "owner",
		createdAt: now,
	});
	const request = { operationId: "claim", networkId };
	const results = await Promise.all([
		claimDemoSession(session.token, userId, request),
		claimDemoSession(session.token, userId, request),
	]);
	expect(results[0]).toEqual(results[1]);
	expect(results[0].projectId).toBe(session.projectId);
	expect(await readDemoSession(session.token)).toBeNull();
	await expect(storage.read()).rejects.toThrow("forbidden");
	const project = await projectOf(session.projectId);
	expect(project.networkId).toBe(networkId);
	expect(project.demoSessionId).toBeNull();
	const claimed = await HostedProjectStorage.open(
		hostedStorageOptions(project, userId),
	);
	const draft = await claimed.drafts.read("draft");
	expect(draft.kind === "result" && draft.result.draft).toMatchObject({
		ownerId: userId,
		revision: 1,
		snapshot: { tree: { "menu.yaml": "name: Demo" } },
	});
});
test("demo resumes one unowned hosted project and rejects another session", async () => {
	const first = await createDemoSession({ rateKey: crypto.randomUUID() });
	const second = await createDemoSession({ rateKey: crypto.randomUUID() });
	expect(
		(await createDemoSession({ rateKey: "resume" }, first.token)).projectId,
	).toBe(first.projectId);
	const project = (
		await db.select().from(projects).where(eq(projects.id, first.projectId))
	)[0]!;
	expect(project.networkId).toBeNull();
	expect(project.serverKeyId).toBeNull();
	const storage = await openDemoProjectStorage(first.principal, project);
	expect((await storage.read()).kind).toBe("result");
	await expect(
		openDemoProjectStorage(second.principal, project),
	).rejects.toThrow("forbidden");
	expect((await readDemoSession(first.token))?.expiresAt).toBe(first.expiresAt);
});
test("guest draft owner matches bootstrap principal across repeated updates and claim", async () => {
	const session = await createDemoSession({ rateKey: "owner-contract" });
	const storage = await openDemoProjectStorage(
		session.principal,
		await projectOf(session.projectId),
	);
	const snapshot = { tree: { "example.yaml": "v: one" }, baseline: {}, at: 1 };
	const created = await storage.drafts.create("repeat", "first", {
		name: "Work",
		snapshot,
	});
	expect(created).toMatchObject({
		kind: "result",
		result: { draft: { ownerId: session.principal.id, revision: 1 } },
	});
	await storage.drafts.update("repeat", 1, "second", {
		name: "Work",
		snapshot: { ...snapshot, tree: { "example.yaml": "v: two" } },
	});
	const reopened = await openDemoProjectStorage(
		session.principal,
		await projectOf(session.projectId),
	);
	expect(await reopened.drafts.read("repeat")).toMatchObject({
		kind: "result",
		result: {
			draft: {
				ownerId: session.principal.id,
				revision: 2,
				snapshot: { tree: { "example.yaml": "v: two" } },
			},
		},
	});
	const { userId, networkId } = await seedOwner();
	await claimDemoSession(session.token, userId, {
		operationId: "claim-repeat",
		networkId,
	});
	const claimed = await HostedProjectStorage.open(
		hostedStorageOptions(await projectOf(session.projectId), userId),
	);
	expect(await claimed.drafts.read("repeat")).toMatchObject({
		kind: "result",
		result: { draft: { ownerId: userId, revision: 2 } },
	});
});
test("initial unauthorized claim target remains recoverable with another target", async () => {
	const session = await createDemoSession({ rateKey: "initial-target" });
	const { userId, networkId } = await seedOwner();
	let denied: unknown;
	try {
		await claimDemoSession(session.token, userId, {
			operationId: "denied",
			networkId: "missing",
		});
	} catch (error) {
		denied = error;
	}
	expect(denied).toMatchObject({ code: "claim_target_unavailable" });
	expect(await readDemoSession(session.token)).not.toBeNull();
	expect(
		await claimDemoSession(session.token, userId, {
			operationId: "valid",
			networkId,
		}),
	).toEqual({ projectId: session.projectId, networkId });
});
