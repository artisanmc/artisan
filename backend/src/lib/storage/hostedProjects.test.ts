import { beforeEach, afterEach, expect, test } from "bun:test";
import {
	mkdtemp,
	rm,
	cp,
	rename,
	mkdir,
	utimes,
	lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import {
	networks,
	projects,
	projectRenames,
	deletedDraftOwners,
} from "../../db/schema";
import { getProject } from "../projectStorage";
import {
	HostedProjectStorage,
	hostedStorageOptions,
} from "./HostedProjectStorage";
import {
	createHostedProject,
	deleteHostedProject,
	listHostedProjects,
	openHostedProjectStorage,
} from "./hostedProjects";
import { beginProjectRename } from "../projectRename";
import { digest } from "./hostedFilesystem";
import { maintainHostedProjects } from "./hostedMaintenance";
let directory: string;
let previous: string | undefined;
beforeEach(async () => {
	previous = process.env.HOSTED_PROJECTS_DIR;
	directory = await mkdtemp(join(tmpdir(), "artisan-hosted-lifecycle-"));
	process.env.HOSTED_PROJECTS_DIR = directory;
	await db.delete(networks);
	await db.delete(deletedDraftOwners);
	const now = new Date();
	await db
		.insert(networks)
		.values({
			id: "hosted-network",
			name: "Hosted",
			createdAt: now,
			updatedAt: now,
		});
});
afterEach(async () => {
	if (previous === undefined) delete process.env.HOSTED_PROJECTS_DIR;
	else process.env.HOSTED_PROJECTS_DIR = previous;
	await rm(directory, { recursive: true, force: true });
});
const input = () => ({
	networkId: "hosted-network",
	folderName: "demo",
	minecraftVersion: "1.21.4",
	ownerId: "owner",
	operationId: "create-once",
	name: "My demo",
});
test("creates serverless Network project idempotently and resolves selected version", async () => {
	const first = await createHostedProject(input());
	const second = await createHostedProject(input());
	expect(second.id).toBe(first.id);
	expect(first).toMatchObject({
		serverKeyId: null,
		storageKind: "hosted",
		hostedMinecraftVersion: "1.21.4",
		name: "My demo",
	});
	expect(await listHostedProjects("hosted-network")).toHaveLength(1);
	const storage = await openHostedProjectStorage(first, "owner");
	expect(await storage.read()).toMatchObject({ result: { ok: true } });
});
test("rename and retry retain SQL anchor, drafts, and directory identity", async () => {
 const project = await createHostedProject({ ...input(), name: "demo" });
	const storage = await openHostedProjectStorage(project, "owner");
	await storage.drafts.create("Draft", "draft-create", {
		name: "Draft",
		snapshot: { tree: {}, baseline: {}, at: 1 },
	});
	expect(await storage.rename("rename-once", "new-name")).toMatchObject({
		ok: true,
		projectId: project.id,
		diskId: "new-name",
	});
	expect(await storage.rename("rename-once", "new-name")).toMatchObject({
		ok: true,
	});
	const fresh = await getProject(project.id);
	expect(fresh?.externalId).toBe("new-name");
 expect(fresh?.name).toBe("new-name");
	expect(
		await (await openHostedProjectStorage(fresh!, "owner")).drafts.read(
			"Draft",
		),
	).toMatchObject({ result: { draft: { ownerId: "owner" } } });
	await deleteHostedProject(project.id, "delete-once");
	expect((await getProject(project.id))?.deletedAt).not.toBeNull();
	expect(await listHostedProjects("hosted-network")).toHaveLength(0);
});
test("SQL metadata and full volume restore preserve resolution and exact content", async () => {
	const original = await createHostedProject(input());
	const storage = await openHostedProjectStorage(original, "owner");
	await storage.write({
		files: [{ path: "x.yaml", content: "restorable", base_hash: null }],
		binaries: [
			{
				path: "textures/a.png",
				content: new Uint8Array([0, 255]),
				baseHash: null,
			},
		],
	});
	await storage.drafts.create("private", "private-create", {
		name: "Saved",
		snapshot: { tree: {}, baseline: {}, at: 1 },
	});
	const backup = await mkdtemp(join(tmpdir(), "artisan-hosted-backup-"));
	try {
		await cp(directory, backup, { recursive: true });
		const metadata = (
			await db.select().from(projects).where(eq(projects.id, original.id))
		)[0]!;
		await db.delete(projects).where(eq(projects.id, original.id));
		await db.insert(projects).values(metadata);
		process.env.HOSTED_PROJECTS_DIR = backup;
		const restored = await openHostedProjectStorage(
			(await getProject(original.id))!,
			"owner",
		);
		expect(await restored.read()).toMatchObject({
			result: {
				files: expect.arrayContaining([
					{ path: "x.yaml", content: "restorable" },
				]),
			},
		});
		expect(await restored.readBinary("textures/a.png")).toMatchObject({
			result: { content: new Uint8Array([0, 255]) },
		});
		expect(await restored.drafts.read("private")).toMatchObject({
			result: { draft: { ownerId: "owner" } },
		});
	} finally {
		process.env.HOSTED_PROJECTS_DIR = directory;
		await rm(backup, { recursive: true, force: true });
	}
});
test("restoring an activated rename with pending SQL intent recovers the original anchor", async () => {
	const project = await createHostedProject(input());
	const storage = await openHostedProjectStorage(project, "owner");
	const operation = await beginProjectRename(
		project.id,
		"lost-rename",
		"renamed",
	);
	await storage.filesystem.locked(async () => {
		const current = await storage.filesystem.current();
		await storage.filesystem.commit(current, async (next) => {
			await rename(
				join(next.directory, "demo"),
				join(next.directory, "renamed"),
			);
			next.state.folderName = "renamed";
			next.state.receipts[digest("rename:lost-rename")] = {
				fingerprint: digest(JSON.stringify(["demo", "renamed"])),
				at: Date.now(),
				result: { ok: true },
			};
		});
	});
	const backup = await mkdtemp(join(tmpdir(), "artisan-pending-backup-"));
	try {
		await cp(directory, backup, { recursive: true });
		await db.delete(projects).where(eq(projects.id, project.id));
		await db.insert(projects).values(project);
		await db.insert(projectRenames).values(operation);
		process.env.HOSTED_PROJECTS_DIR = backup;
		await maintainHostedProjects();
		expect((await getProject(project.id))?.externalId).toBe("renamed");
		expect(
			(
				await db
					.select()
					.from(projectRenames)
					.where(eq(projectRenames.id, operation.id))
			)[0]?.status,
		).toBe("complete");
		expect(
			await (
				await openHostedProjectStorage((await getProject(project.id))!, "owner")
			).read(),
		).toMatchObject({ result: { ok: true } });
	} finally {
		process.env.HOSTED_PROJECTS_DIR = directory;
		await rm(backup, { recursive: true, force: true });
	}
});
test("maintenance consumes committed owner tombstones and conservatively collects only abandoned generated roots", async () => {
	const project = await createHostedProject(input());
	const storage = await openHostedProjectStorage(project, "owner");
	await storage.drafts.create("mine", "mine-create", {
		name: "private",
		snapshot: { baseline: {}, tree: {}, at: 1 },
	});
	await db
		.insert(deletedDraftOwners)
		.values({ ownerId: "owner", deletedAt: new Date() })
		.onConflictDoNothing();
	const orphan = join(directory, "hosted_" + "a".repeat(32));
	const foreign = join(directory, "manual-folder");
	await mkdir(orphan);
	await mkdir(foreign);
	const old = new Date(Date.now() - 2 * 86_400_000);
	await utimes(orphan, old, old);
	await utimes(foreign, old, old);
	await maintainHostedProjects();
	expect(await storage.drafts.read("mine")).toMatchObject({
		result: { error: "not_found" },
	});
	let orphanExists = true;
	try {
		await lstat(orphan);
	} catch {
		orphanExists = false;
	}
	expect(orphanExists).toBe(false);
	expect((await lstat(foreign)).isDirectory()).toBe(true);
	expect(
		(await lstat(join(directory, project.hostedRootId!))).isDirectory(),
	).toBe(true);
	await db
		.delete(deletedDraftOwners)
		.where(eq(deletedDraftOwners.ownerId, "owner"));
});
test("retired root collection is idempotent after retention expires", async () => {
	const project = await createHostedProject(input());
	await deleteHostedProject(project.id, "delete");
	const afterRetention = Date.now() + 31 * 86_400_000;
	await maintainHostedProjects(afterRetention);
	await maintainHostedProjects(afterRetention);
	expect((await getProject(project.id))?.deletedAt).not.toBeNull();
	let exists = true;
	try {
		await lstat(join(directory, project.hostedRootId!));
	} catch {
		exists = false;
	}
	expect(exists).toBe(false);
});
test("more concurrent creations than the pool size cannot starve nested root locks", async () => {
	const created = await Promise.all(
		Array.from({ length: 16 }, (_, i) =>
			createHostedProject({
				...input(),
				folderName: "parallel-" + i,
				operationId: "parallel-" + i,
			}),
		),
	);
	expect(new Set(created.map((p) => p.id)).size).toBe(16);
	await Promise.all([
		maintainHostedProjects(),
		...created.map(async (p) => {
			const storage = await openHostedProjectStorage(p, "owner");
			expect(
				await storage.write({
					files: [{ path: "x.yaml", content: "parallel", base_hash: null }],
				}),
			).toMatchObject({ result: { ok: true } });
		}),
	]);
}, 30_000);
