import { randomBytes } from "node:crypto";
import { lstat, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "../db";
import {
	deletedDraftOwners,
	demoSessions,
	memberships,
	projectRenames,
	projects,
} from "../db/schema";
import demoTemplate from "../templates/demo-project.json";
import { can } from "./capabilities";
import { demoMinecraftVersion } from "./demoVersion";
import type { GuestPrincipal } from "./projectPrincipal";
import type { Project } from "./projectStorage";
import {
	HostedProjectStorage,
	hostedStorageOptions,
} from "./storage/HostedProjectStorage";
import {
	HostedFilesystem,
	type HostedRevision,
	digest,
	logicalId,
	measureHostedTree,
	safeTree,
} from "./storage/hostedFilesystem";
import {
	storageDatabase,
	storageTransaction,
} from "./storage/storageTransaction";

export class DemoError extends Error {
	constructor(readonly code: string) {
		super(code);
	}
}
type DemoSession = typeof demoSessions.$inferSelect;
export interface DemoBootstrap {
	token: string;
	csrfToken: string;
	principal: GuestPrincipal;
	projectId: string;
	expiresAt: string;
}
const setting = (name: string, fallback: number) => {
	const value = Number(process.env[name] ?? fallback);
	if (!Number.isSafeInteger(value) || value < 1)
		throw new DemoError("invalid_demo_config");
	return value;
};
const ttl = () => setting("DEMO_TTL_HOURS", 24) * 3_600_000;
const volume = () =>
	resolve(process.env.HOSTED_PROJECTS_DIR ?? "data/hosted-projects");
const csrf = (token: string) => digest(`artisan-demo-csrf:${token}`);
const owner = (session: DemoSession) => session.id;
const validToken = (token: string) => /^[a-f0-9]{64}$/.test(token);
const bootstrap = (session: DemoSession, token: string): DemoBootstrap => ({
	token,
	csrfToken: csrf(token),
	principal: { kind: "guest", id: session.id, projectId: session.projectId },
	projectId: session.projectId,
	expiresAt: session.expiresAt.toISOString(),
});
async function globalLock() {
	const tx = storageDatabase();
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtext('hosted-maintenance'))`,
	);
	await tx.execute(sql`select pg_advisory_xact_lock(hashtext('demo-global'))`);
}
async function sessionLock(id: string) {
	await storageDatabase().execute(
		sql`select pg_advisory_xact_lock(hashtext(${`demo:${id}`}))`,
	);
}
export async function getDemoSessionProof(token: string) {
	if (!validToken(token)) return null;
	const session = (
		await storageDatabase()
			.select()
			.from(demoSessions)
			.where(eq(demoSessions.tokenHash, digest(token)))
	)[0];
	return session ? { ...session, csrfToken: csrf(token) } : null;
}
async function activeSession(id: string, projectId?: string) {
	const session = (
		await storageDatabase()
			.select()
			.from(demoSessions)
			.where(eq(demoSessions.id, id))
	)[0];
	if (
		!session ||
		session.state !== "active" ||
		(projectId && session.projectId !== projectId)
	)
		throw new DemoError("forbidden");
	const project = (
		await storageDatabase()
			.select()
			.from(projects)
			.where(eq(projects.id, session.projectId))
	)[0];
	if (
		!project ||
		project.deletedAt ||
		project.networkId ||
		project.demoSessionId !== id
	)
		throw new DemoError("forbidden");
	// Filesystem activity survives an activation followed by a SQL rollback/crash.
	const current = await new HostedFilesystem(
		volume(),
		project.hostedRootId!,
	).current();
	const activity = Math.max(
		session.lastActivityAt.getTime(),
		current.state.demoActivityAt ?? 0,
	);
	const expiresAt = new Date(activity + ttl());
	if (expiresAt.getTime() <= Date.now()) throw new DemoError("demo_expired");
	return { ...session, lastActivityAt: new Date(activity), expiresAt };
}
export async function readDemoSession(
	token: string,
): Promise<DemoBootstrap | null> {
	const proof = await getDemoSessionProof(token);
	if (!proof) return null;
	return storageTransaction(async () => {
		await globalLock();
		await sessionLock(proof.id);
		try {
			return bootstrap(await activeSession(proof.id), token);
		} catch (error) {
			if (error instanceof DemoError) return null;
			throw error;
		}
	});
}
export async function authorizeDemoProject(
	principal: GuestPrincipal,
	projectId: string,
) {
	if (principal.projectId !== projectId) throw new DemoError("forbidden");
	return storageTransaction(async () => {
		await globalLock();
		await sessionLock(principal.id);
		return activeSession(principal.id, projectId);
	});
}
async function globalUsage() {
	let bytes = 0;
	const claimed = new Set(
		(
			await storageDatabase()
				.select()
				.from(demoSessions)
				.where(eq(demoSessions.state, "claimed"))
		).map((s) => s.projectId),
	);
	try {
		for (const name of await readdir(volume()))
			if (/^demo_[a-f0-9]{32}$/.test(name) && !claimed.has(name)) {
				await safeTree(join(volume(), name));
				bytes += (await measureHostedTree(join(volume(), name))).bytes;
			}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	return bytes;
}
async function contentDigest(revision: HostedRevision) {
	const entries: string[] = [];
	const visit = async (path: string, relative: string) => {
		for (const entry of (await readdir(path, { withFileTypes: true })).sort(
			(a, b) => (a.name < b.name ? -1 : 1),
		)) {
			const next = join(path, entry.name);
			const key = `${relative}/${entry.name}`;
			if (entry.isDirectory()) await visit(next, key);
			else entries.push(`${key}:${digest(await readFile(next))}`);
		}
	};
	await visit(join(revision.directory, revision.state.folderName), "");
	return digest(entries.join("\n"));
}
export async function openDemoProjectStorage(
	principal: GuestPrincipal,
	project: Project,
) {
	await authorizeDemoProject(principal, project.id);
	const storage = await HostedProjectStorage.open({
		...hostedStorageOptions(project, principal.id),
		beforeLock: async () => {
			await globalLock();
			await sessionLock(principal.id);
			await activeSession(principal.id, project.id);
		},
		beforeCommit: async (previous, next) => {
			if (
				previous &&
				(await contentDigest(previous)) === (await contentDigest(next))
			)
				return;
			const now = Date.now();
			const mutations = (previous?.state.demoMutationTimes ?? []).filter(
				(at) => at > now - 60_000,
			);
			if (mutations.length >= setting("DEMO_MUTATIONS_PER_MINUTE", 60))
				throw new DemoError("demo_rate_limited");
			next.state.demoMutationTimes = [...mutations, now];
			next.state.demoActivityAt = now;
			await storageDatabase()
				.update(demoSessions)
				.set({
					lastActivityAt: new Date(now),
					expiresAt: new Date(now + ttl()),
				})
				.where(eq(demoSessions.id, principal.id));
		},
		beforeActivate: async (usage) => {
			if (
				usage.totalBytes > setting("DEMO_MAX_BYTES", 20 * 1024 * 1024) ||
				usage.totalFiles > setting("DEMO_MAX_FILES", 1000)
			)
				throw new DemoError("demo_quota_exceeded");
			if (
				(await globalUsage()) >
				setting("DEMO_GLOBAL_MAX_BYTES", 512 * 1024 * 1024)
			)
				throw new DemoError("demo_capacity_exceeded");
		},
	});
	return Object.assign(storage, {
		capabilities: Object.freeze({
			...storage.capabilities,
			canRename: false,
			canCopyToServer: false,
			canUseAssistant: false,
			canImport: false,
			canDelete: false,
		}),
	});
}
export async function createDemoSession(
	input: { rateKey: string },
	token?: string,
): Promise<DemoBootstrap> {
	if (token) {
		const prior = await readDemoSession(token);
		if (prior) return prior;
	}
	const minecraftVersion = await demoMinecraftVersion();
	return storageTransaction(async (tx) => {
		await globalLock();
		const now = new Date();
		const rateKey = digest(input.rateKey);
		const recent = await tx
			.select()
			.from(demoSessions)
			.where(
				and(
					eq(demoSessions.rateKey, rateKey),
					gte(demoSessions.createdAt, new Date(now.getTime() - 3_600_000)),
				),
			);
		if (recent.length >= setting("DEMO_CREATIONS_PER_HOUR", 5))
			throw new DemoError("demo_rate_limited");
		const active = await tx
			.select()
			.from(demoSessions)
			.where(sql`${demoSessions.state} IN ('active', 'claiming')`);
		if (active.length >= setting("DEMO_MAX_SESSIONS", 1000))
			throw new DemoError("demo_capacity_exceeded");
		const raw = randomBytes(32).toString("hex");
		const id = `demo_${randomBytes(16).toString("hex")}`;
		const session: DemoSession = {
			id,
			tokenHash: digest(raw),
			projectId: id,
			state: "active",
			createdAt: now,
			lastActivityAt: now,
			expiresAt: new Date(now.getTime() + ttl()),
			rateKey,
			claimOperationId: null,
			claimOwnerId: null,
			claimNetworkId: null,
			supersededClaims: [],
		};
		const project: Project = {
			id,
			networkId: null,
			demoSessionId: id,
			serverKeyId: null,
			storageKind: "hosted",
			hostedRootId: id,
			hostedMinecraftVersion: minecraftVersion,
			hostedCreationFingerprint: digest(id),
			identityKind: "folder",
			name: "Welcome to Artisan",
			externalId: "demo",
			description: null,
			deletedAt: null,
			createdAt: now,
			updatedAt: now,
		};
		await tx.insert(demoSessions).values(session);
		const storage = await HostedProjectStorage.initialize(
			hostedStorageOptions(project, owner(session)),
		);
		try {
			const written = await storage.write({
				operationId: "demo-seed",
				files: Object.entries(demoTemplate).map(([path, content]) => ({
					path,
					content,
					base_hash: null,
				})),
			});
			if (written.kind !== "result" || !written.result.ok)
				throw new DemoError("demo_unavailable");
			await storage.filesystem.collect();
			const usage = await measureHostedTree(storage.filesystem.directory);
			if (
				usage.bytes > setting("DEMO_MAX_BYTES", 20 * 1024 * 1024) ||
				usage.files > setting("DEMO_MAX_FILES", 1000)
			)
				throw new DemoError("demo_quota_exceeded");
			if (
				(await globalUsage()) >
				setting("DEMO_GLOBAL_MAX_BYTES", 512 * 1024 * 1024)
			)
				throw new DemoError("demo_capacity_exceeded");
			await tx.insert(projects).values(project);
			return bootstrap(session, raw);
		} catch (error) {
			await safeTree(storage.filesystem.directory);
			await rm(storage.filesystem.directory, { recursive: true });
			throw error;
		}
	});
}

export async function claimDemoSession(
	token: string,
	userId: string,
	input: { operationId: string; networkId: string },
	checkpoint?: (step: string) => Promise<void>,
) {
	if (!logicalId(input.operationId) || !input.networkId)
		throw new DemoError("invalid_input");
	const proof = await getDemoSessionProof(token);
	if (!proof) throw new DemoError("forbidden");
	return claimByProof(proof, userId, input, checkpoint);
}
export async function resumeOwnedDemoClaim(
	userId: string,
	input: { projectId: string; operationId: string; networkId: string },
) {
	const proof = (
		await storageDatabase()
			.select()
			.from(demoSessions)
			.where(
				and(
					eq(demoSessions.projectId, input.projectId),
					eq(demoSessions.claimOwnerId, userId),
				),
			)
	)[0];
	if (!proof || !["claiming", "claimed"].includes(proof.state))
		throw new DemoError("forbidden");
	return claimByProof(proof, userId, input);
}
async function claimByProof(
	proof: DemoSession,
	userId: string,
	input: { operationId: string; networkId: string },
	checkpoint?: (step: string) => Promise<void>,
) {
	if (!logicalId(input.operationId) || !input.networkId)
		throw new DemoError("invalid_input");
	// Commit intent before changing the filesystem: retries and maintenance resume this owner only.
	await storageTransaction(async (tx) => {
		await globalLock();
		await sessionLock(proof.id);
		const current = (
			await tx.select().from(demoSessions).where(eq(demoSessions.id, proof.id))
		)[0]!;
		if (
			current.supersededClaims.some(
				(claim) => claim.operationId === input.operationId,
			)
		)
			throw new DemoError("operation_superseded");
		if (current.state === "claiming" || current.state === "claimed") {
			if (current.claimOwnerId !== userId) throw new DemoError("forbidden");
			if (
				current.claimOperationId === input.operationId &&
				current.claimNetworkId === input.networkId
			)
				return;
			if (
				current.state === "claimed" ||
				current.claimOperationId === input.operationId
			)
				throw new DemoError("operation_mismatch");
			const oldMembership = (
				await tx
					.select()
					.from(memberships)
					.where(
						and(
							eq(memberships.userId, userId),
							eq(memberships.networkId, current.claimNetworkId!),
						),
					)
			)[0];
			if (oldMembership && can(oldMembership.role, "edit_content"))
				throw new DemoError("operation_mismatch");
		} else {
			await activeSession(proof.id);
		}
		const membership = (
			await tx
				.select()
				.from(memberships)
				.where(
					and(
						eq(memberships.userId, userId),
						eq(memberships.networkId, input.networkId),
					),
				)
		)[0];
		if (!membership || !can(membership.role, "edit_content"))
			throw new DemoError("claim_target_unavailable");
		const supersededClaims =
			current.state === "claiming"
				? [
						...current.supersededClaims,
						{
							operationId: current.claimOperationId!,
							networkId: current.claimNetworkId!,
							ownerId: userId,
						},
					]
				: current.supersededClaims;
		await tx
			.update(demoSessions)
			.set({
				state: "claiming",
				claimOwnerId: userId,
				claimOperationId: input.operationId,
				claimNetworkId: input.networkId,
				supersededClaims,
			})
			.where(eq(demoSessions.id, proof.id));
	});
	await checkpoint?.("intent");
	return finishClaim(proof.id, checkpoint);
}
async function finishClaim(
	id: string,
	checkpoint?: (step: string) => Promise<void>,
) {
	return storageTransaction(async (tx) => {
		await globalLock();
		await sessionLock(id);
		const session = (
			await tx.select().from(demoSessions).where(eq(demoSessions.id, id))
		)[0]!;
		if (
			!session ||
			!session.claimNetworkId ||
			!session.claimOwnerId ||
			!["claiming", "claimed"].includes(session.state)
		)
			throw new DemoError("forbidden");
		if (session.state === "claimed") {
			const project = (await tx.select().from(projects).where(eq(projects.id, session.projectId)))[0];
			return {
				projectId: session.projectId,
				networkId: session.claimNetworkId,
				urlId: project?.externalId ?? session.projectId,
			};
		}
		const membership = (
			await tx
				.select()
				.from(memberships)
				.where(
					and(
						eq(memberships.userId, session.claimOwnerId),
						eq(memberships.networkId, session.claimNetworkId),
					),
				)
				.for("share")
		)[0];
		if (!membership || !can(membership.role, "edit_content"))
			throw new DemoError("claim_target_unavailable");
		const project = (
			await tx.select().from(projects).where(eq(projects.id, session.projectId))
		)[0]!;
		const storage = await HostedProjectStorage.open(
			hostedStorageOptions(project, session.claimOwnerId),
		);
		await storage.remapDraftOwner(owner(session), session.claimOwnerId);
		await checkpoint?.("owner_remapped");
		await tx.execute(
			sql`select pg_advisory_xact_lock(hashtext(${`hosted-network:${session.claimNetworkId}`}))`,
		);
		const occupied = await tx
			.select()
			.from(projects)
			.where(
				and(
					eq(projects.networkId, session.claimNetworkId),
					eq(projects.storageKind, "hosted"),
				),
			);

		const pendingRename = await tx
			.select()
			.from(projectRenames)
			.where(
				and(
					eq(projectRenames.hostedNetworkId, session.claimNetworkId),
					eq(projectRenames.status, "pending"),
				),
			);
		const usedFolders = new Set([
			...occupied.map((p) => p.externalId?.toLowerCase()),
			...pendingRename.map((p) => p.targetId.toLowerCase()),
		]);
		const base = `demo-${id.slice(5)}`;
		let folder = base;
		for (let suffix = 2; usedFolders.has(folder.toLowerCase()); suffix++)
			folder = `${base}-${suffix}`;
		await storage.filesystem.locked(async () => {
			const current = await storage.filesystem.current();
			if (current.state.folderName !== folder) {
				await storage.filesystem.commit(current, async (next) => {
					const { rename } = await import("node:fs/promises");
					await rename(
						join(next.directory, next.state.folderName),
						join(next.directory, folder),
					);
					next.state.folderName = folder;
				});
			}
		});
		await tx
			.update(projects)
			.set({
				networkId: session.claimNetworkId,
				demoSessionId: null,
				externalId: folder,
				updatedAt: new Date(),
			})
			.where(eq(projects.id, project.id));
		await tx
			.update(demoSessions)
			.set({ state: "claimed" })
			.where(eq(demoSessions.id, id));
		return { projectId: project.id, networkId: session.claimNetworkId, urlId: folder };
	});
}
export async function maintainDemoSessions(
	checkpoint?: (step: string) => Promise<void>,
) {
	const errors: { rootId: string; error: unknown }[] = [];
	const sessions = await db
		.select()
		.from(demoSessions)
		.where(sql`${demoSessions.state} IN ('active', 'claiming', 'expired')`);
	for (const session of sessions) {
		try {
			if (session.state === "claiming") {
				const deletedOwner = (
					await db
						.select()
						.from(deletedDraftOwners)
						.where(eq(deletedDraftOwners.ownerId, session.claimOwnerId!))
				)[0];
				if (deletedOwner) {
					await storageTransaction(async (tx) => {
						await globalLock();
						await sessionLock(session.id);
						const fresh = (
							await tx
								.select()
								.from(demoSessions)
								.where(eq(demoSessions.id, session.id))
						)[0];
						if (
							fresh?.state === "claiming" &&
							fresh.claimOwnerId === deletedOwner.ownerId
						) {
							await tx
								.update(demoSessions)
								.set({
									state: "expired",
									claimOwnerId: null,
									claimNetworkId: null,
									claimOperationId: null,
								})
								.where(eq(demoSessions.id, session.id));
							await tx
								.update(projects)
								.set({ deletedAt: new Date() })
								.where(eq(projects.id, session.projectId));
						}
					});
				} else {
					try {
						await finishClaim(session.id);
					} catch (error) {
						if (
							!(error instanceof DemoError) ||
							error.code !== "claim_target_unavailable"
						)
							throw error;
					}
					continue;
				}
			}
			await storageTransaction(async (tx) => {
				await globalLock();
				await sessionLock(session.id);
				const fresh = (
					await tx
						.select()
						.from(demoSessions)
						.where(eq(demoSessions.id, session.id))
				)[0];
				if (!fresh || !["active", "expired"].includes(fresh.state)) return;
				if (fresh.state === "expired") return;
				if (fresh.state === "active") {
					try {
						await activeSession(fresh.id);
						return;
					} catch (error) {
						if (!(error instanceof DemoError) || error.code !== "demo_expired")
							throw error;
					}
				}
				await tx
					.update(demoSessions)
					.set({ state: "expired" })
					.where(eq(demoSessions.id, fresh.id));
				await tx
					.update(projects)
					.set({ deletedAt: new Date() })
					.where(eq(projects.id, fresh.projectId));
			});
			await storageTransaction(async (tx) => {
				await globalLock();
				await sessionLock(session.id);
				const fresh = (
					await tx
						.select()
						.from(demoSessions)
						.where(eq(demoSessions.id, session.id))
				)[0];
				if (fresh?.state !== "expired") return;
				const directory = join(volume(), fresh.projectId);
				try {
					await lstat(directory);
					await safeTree(directory);
					await rm(directory, { recursive: true });
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				}
				await checkpoint?.("purged");
				const [project] = await tx
					.select()
					.from(projects)
					.where(eq(projects.id, fresh.projectId));
				if (
					project?.deletedAt &&
					Date.now() - project.deletedAt.getTime() >= 86_400_000
				) {
					await tx.delete(projects).where(eq(projects.id, fresh.projectId));
					await tx.delete(demoSessions).where(eq(demoSessions.id, fresh.id));
				}
			});
		} catch (error) {
			errors.push({ rootId: session.projectId, error });
		}
	}
	await storageTransaction(async () => {
		await globalLock();
		const known = new Set(
			(await storageDatabase().select().from(demoSessions)).map(
				(s) => s.projectId,
			),
		);
		let names: string[];
		try {
			names = await readdir(volume());
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
		for (const name of names)
			if (/^demo_[a-f0-9]{32}$/.test(name) && !known.has(name)) {
				const directory = join(volume(), name);
				if (Date.now() - (await lstat(directory)).mtimeMs < 86_400_000)
					continue;
				await safeTree(directory);
				await rm(directory, { recursive: true });
			}
	});
	return errors;
}
