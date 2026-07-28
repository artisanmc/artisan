import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/index";
import { projects, serverKeys } from "../db/schema";
import { createBranch } from "./branchStorage";
import { createCommit } from "./commitStorage";
import { allocProjectSlug } from "./slugAlloc";

export type Project = typeof projects.$inferSelect;

export async function createProject(input: {
	networkId: string;
	serverKeyId: string; // required: the server_key that owns this project
	name: string;
	description?: string | null;
	id?: string; // optional, default generated
}): Promise<Project> {
	const id =
		input.id ?? "pack_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
	const now = new Date();
	const slug = await allocProjectSlug(input.serverKeyId, input.name);
	// Idempotent sur l'id : deux chemins concurrents (hello stub-create, setup,
	// local_push, POST /bundles) peuvent tenter de créer le même project — le
	// perdant récupère l'existant au lieu de faire crasher le process sur un
	// duplicate key (incident smoke Docker 2026-07-09).
	const inserted = await db.insert(projects).values({
		id,
		networkId: input.networkId,
		serverKeyId: input.serverKeyId,
		name: input.name,
		slug,
		description: input.description ?? null,
		hash: "",
		filesJson: "{}",
		deletedAt: null,
		createdAt: now,
		updatedAt: now,
	}).onConflictDoNothing({ target: projects.id }).returning({ id: projects.id });
	if (inserted.length === 0) {
		return (await getProject(id))!;
	}
	// Phase 2: auto-create main branch with an initial empty commit (empty file
	// tree — hashes to the "" sentinel, keeping the plugin's auto-push branch
	// reachable for fresh stubs).
	const root = await createCommit({
		projectId: id,
		parentId: null,
		files: {},
		authorUserId: null,
		message: "Initial commit",
	});
	await createBranch(id, "main", root.id);
	return (await getProject(id))!;
}

/**
 * Résout une référence de project (id **ou** slug) vers son id.
 *
 * Le slug n'est unique QUE par serveur (`projects_serverkey_slug_uniq`) — il
 * n'est donc résoluble qu'avec le serveur en portée, que l'URL de l'éditeur
 * porte déjà. Sans `serverRef`, la référence est traitée comme un id (comportement
 * historique). Un `serverRef` ambigu (slug porté par plusieurs serveurs, les
 * slugs de serveur n'étant uniques que par network) ne résout rien plutôt que de
 * risquer le mauvais project.
 */
export async function resolveProjectRef(
	ref: string,
	serverRef?: string | null,
): Promise<string | null> {
	if (!serverRef) return ref;
	const keys = await db
		.select({ id: serverKeys.id })
		.from(serverKeys)
		.where(or(eq(serverKeys.id, serverRef), eq(serverKeys.slug, serverRef)));
	if (keys.length !== 1) return null;
	const rows = await db
		.select({ id: projects.id })
		.from(projects)
		.where(
			and(
				eq(projects.serverKeyId, keys[0]!.id),
				or(eq(projects.id, ref), eq(projects.slug, ref)),
				isNull(projects.deletedAt),
			),
		);
	return rows[0]?.id ?? null;
}

export async function getProject(id: string): Promise<Project | null> {
	const rows = await db.select().from(projects).where(eq(projects.id, id));
	return rows[0] ?? null;
}

/**
 * Write project content, bumping the optimistic-concurrency `version`.
 *
 * With `opts.expectedVersion`, the update only applies if the stored version
 * still matches (compare-and-swap). Returns the new version, or `null` when
 * the precondition failed (concurrent write) or the project doesn't exist.
 */
export async function upsertProjectContent(
	id: string,
	patch: {
		hash?: string;
		filesJson?: string;
	},
	opts?: { expectedVersion?: number },
): Promise<number | null> {
	const where =
		opts?.expectedVersion === undefined
			? eq(projects.id, id)
			: and(eq(projects.id, id), eq(projects.version, opts.expectedVersion));
	const rows = await db
		.update(projects)
		.set({ ...patch, version: sql`${projects.version} + 1`, updatedAt: new Date() })
		.where(where)
		.returning({ version: projects.version });
	return rows[0]?.version ?? null;
}

export async function softDeleteProject(id: string): Promise<void> {
	await db
		.update(projects)
		.set({ deletedAt: new Date(), updatedAt: new Date() })
		.where(eq(projects.id, id));
}

export async function listProjectsForNetwork(
	networkId: string,
): Promise<Project[]> {
	return await db
		.select()
		.from(projects)
		.where(and(eq(projects.networkId, networkId), isNull(projects.deletedAt)));
}
