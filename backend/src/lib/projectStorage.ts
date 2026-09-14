import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/index";
import { projects, projectRenames, projectCopies } from "../db/schema";
import { resolveScopedProjectRef } from "./refs";
import { ProjectRenameError, projectLifecycleScope } from "./projectRename";

export type Project = typeof projects.$inferSelect;

export async function createProject(input: {
	networkId: string;
	serverKeyId: string; // required: the server_key that owns this project
	name: string;
	description?: string | null;
	id?: string; // optional, default generated
	externalId?: string | null; // disk/wire id; defaults to the internal id
}): Promise<Project> {
	const id =
		input.id ?? "pack_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
	const now = new Date();
	// Idempotent sur l'id : deux chemins concurrents (hello stub-create, setup,
	// local_push, POST /bundles) peuvent tenter de créer le même project — le
	// perdant récupère l'existant au lieu de faire crasher le process sur un
	// duplicate key (incident smoke Docker 2026-07-09).
	const inserted = await db.insert(projects).values({
		id,
		networkId: input.networkId,
		serverKeyId: input.serverKeyId,
		name: input.name,
		externalId: input.externalId ?? id,
		description: input.description ?? null,
		deletedAt: null,
		createdAt: now,
		updatedAt: now,
	}).onConflictDoNothing({ target: projects.id }).returning({ id: projects.id });
	return (await getProject(id))!;
}

/** Translate a scoped public reference into the immutable backend anchor. */
export async function resolveProjectRef(
	ref: string,
	serverRef?: string | null,
	networkRef?: string | null,
): Promise<string | null> {
	return resolveScopedProjectRef(ref, serverRef, networkRef);
}

export async function getProject(id: string): Promise<Project | null> {
	const rows = await db.select().from(projects).where(eq(projects.id, id));
	return rows[0] ?? null;
}

/**
 * The id a project answers to on the wire and on the owning server's disk.
 *
 * Rows created before `external_id` existed carry `null` and are addressed by
 * their internal id, which was the disk id back then — so the fallback is exact,
 * not a guess.
 */
export function projectDiskId(p: Pick<Project, "id" | "externalId">): string {
	return p.externalId ?? p.id;
}

/**
 * Resolve a project by the id its OWNING SERVER uses (disk / wire id).
 *
 * Never resolves across server keys: an id like `boutique_shop` is bootstrapped
 * identically by the Boutique add-on on every server that installs it, so a
 * global lookup would hand one server another's project — cross-tenant write,
 * incident 2026-08-12. Callers holding a server key MUST use this, never
 * `getProject`.
 */
export async function getProjectForServer(
	serverKeyId: string,
	diskId: string,
): Promise<Project | null> {
	const rows = await db
		.select()
		.from(projects)
		.where(
			and(
				eq(projects.serverKeyId, serverKeyId),
				or(eq(projects.externalId, diskId), and(eq(projects.id, diskId), isNull(projects.externalId))),
			),
		);
	return rows[0] ?? null;
}

/**
 * Get-or-create the project a server addresses as [diskId].
 *
 * The internal id keeps the disk id when it is still globally free (so existing
 * deployments and single-server setups read identically), and falls back to a
 * generated id when another server already claimed it.
 */
export async function ensureProjectForServer(input: {
	networkId: string;
	serverKeyId: string;
	diskId: string;
}): Promise<Project> {
	return db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.serverKeyId}))`);
		const copying = await tx.select().from(projectCopies).where(and(eq(projectCopies.serverKeyId, input.serverKeyId), eq(projectCopies.status, "pending"), sql`lower(${projectCopies.targetId}) = lower(${input.diskId})`));
		if (copying.length) throw new ProjectRenameError("destination_reserved");
		const existing = (await tx.select().from(projects).where(and(eq(projects.serverKeyId, input.serverKeyId), sql`coalesce(${projects.externalId}, ${projects.id}) = ${input.diskId}`)))[0];
		if (existing) return existing;
		const reservation = (await tx.select().from(projectRenames).where(and(eq(projectRenames.serverKeyId, input.serverKeyId), sql`lower(${projectRenames.targetId}) = lower(${input.diskId})`, eq(projectRenames.status, "pending"))))[0];
		if (reservation) return (await tx.select().from(projects).where(eq(projects.id, reservation.projectId)))[0]!;
		const taken = (await tx.select().from(projects).where(eq(projects.id, input.diskId)))[0];
		const id = taken ? "proj_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12) : input.diskId;
		const now = new Date();
		const inserted = await tx.insert(projects).values({ id, networkId: input.networkId, serverKeyId: input.serverKeyId, name: input.diskId, externalId: input.diskId, createdAt: now, updatedAt: now }).onConflictDoNothing({ target: projects.id }).returning();
		if (inserted[0]) return inserted[0];
		// Another server may claim the globally free legacy ID concurrently.
		return (await tx.insert(projects).values({ id: "proj_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12), networkId: input.networkId, serverKeyId: input.serverKeyId, name: input.diskId, externalId: input.diskId, createdAt: now, updatedAt: now }).returning())[0]!;
	});
}

export async function softDeleteProject(id: string): Promise<void> {
	const anchor = await getProject(id);
	if (!anchor) return;
	await db.transaction(async (tx) => {
		await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${projectLifecycleScope(anchor)}))`);
		const project = (await tx.select().from(projects).where(eq(projects.id, id)).for("update"))[0];
		if (!project || project.deletedAt) return;
		if (project.serverKeyId !== anchor.serverKeyId) throw new ProjectRenameError("operation_mismatch");
		const pending = (await tx.select().from(projectRenames).where(and(eq(projectRenames.projectId, id), eq(projectRenames.status, "pending"))))[0];
		if (pending) throw new ProjectRenameError("rename_in_progress");
		await tx.update(projects).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(projects.id, id));
	});
}

export async function listProjectsForNetwork(
	networkId: string,
): Promise<Project[]> {
	return await db
		.select()
		.from(projects)
		.where(and(eq(projects.networkId, networkId), isNull(projects.deletedAt)));
}
