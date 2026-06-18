import { and, eq, isNull } from "drizzle-orm";
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
 * used to get `editor: null` from GET /api/v1/user/packs/:packId and render a
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
	await db.insert(projects).values({
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
	});
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

export async function upsertProjectContent(
	id: string,
	patch: {
		hash?: string;
		filesJson?: string;
		editorJson?: string | null;
		deployedEditorJson?: string | null;
	},
): Promise<void> {
	await db
		.update(projects)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(projects.id, id));
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
