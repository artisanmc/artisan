import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "../db/index";
import { projects, serverKeys } from "../db/schema";
import { allocProjectSlug } from "./slugAlloc";

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
		externalId: input.externalId ?? id,
		slug,
		description: input.description ?? null,
		deletedAt: null,
		createdAt: now,
		updatedAt: now,
	}).onConflictDoNothing({ target: projects.id }).returning({ id: projects.id });
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
	const existing = await getProjectForServer(input.serverKeyId, input.diskId);
	if (existing) return existing;
	const taken = await getProject(input.diskId);
	const id = taken
		? "proj_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12)
		: input.diskId;
	return await createProject({
		networkId: input.networkId,
		serverKeyId: input.serverKeyId,
		name: input.diskId,
		id,
		externalId: input.diskId,
	});
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
