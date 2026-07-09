import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/index";
import { projects } from "../db/schema";
import { createBranch } from "./branchStorage";
import { createCommit } from "./commitStorage";
import { allocProjectSlug } from "./slugAlloc";

export type Project = typeof projects.$inferSelect;

/**
 * Initial editor JSON shape for a freshly created project. Mirrors the editor's
 * `Project` TypeScript type — every collection field is empty so the editor can
 * render an empty project without crashing. Without this default, the editor
 * used to get `editor: null` from GET /api/v1/user/projects/:projectId and render a
 * black screen.
 */
function defaultEditorJson(id: string, name: string, now: Date): string {
	const iso = now.toISOString();
	return JSON.stringify({
		id,
		name,
		source: "user_created",
		createdAt: iso,
		updatedAt: iso,
		menus: [],
		commands: [],
		templates: [],
		assets: [],
		dataSources: [],
		importedConnectors: [],
		i18nKeys: {},
		defaultLang: "en",
		dialogs: [],
		canvasLayout: {},
	});
}

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
	const initialEditor = defaultEditorJson(id, input.name, now);
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
		editorJson: initialEditor,
		deployedEditorJson: null,
		deletedAt: null,
		createdAt: now,
		updatedAt: now,
	}).onConflictDoNothing({ target: projects.id }).returning({ id: projects.id });
	if (inserted.length === 0) {
		return (await getProject(id))!;
	}
	// Phase 2: auto-create main branch with an initial empty commit carrying
	// the same default editor shape, so any plugin downloading the bundle gets
	// valid JSON instead of null.
	const root = await createCommit({
		projectId: id,
		parentId: null,
		files: {},
		editor: JSON.parse(initialEditor),
		authorUserId: null,
		message: "Initial commit",
	});
	await createBranch(id, "main", root.id);
	return (await getProject(id))!;
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
		editorJson?: string | null;
		deployedEditorJson?: string | null;
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
