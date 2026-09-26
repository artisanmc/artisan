import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../db";
import { deletedDraftOwners, projectDraftBlobs, projectDrafts, projectDraftStorage, projects, users } from "../db/schema";
import { expireDraftReceipts } from "./storage/ReceiptDraftStore";
import { requestProjectDraft, supportsProjectDrafts } from "../ws/hub";
import { projectDiskId, type Project } from "./projectStorage";
import { lockDraftProject } from "./storage/SqlDraftStore";
import type { StoredDraft } from "./storage/DraftStore";
import type { DraftTransport } from "./storage/ServerDraftStore";

/**
 * Rapatrie dans le backend les brouillons partis sur le disque du serveur
 * (ADR `snapshot-mirror-and-backend-history`, décision 4 — inverse de la
 * migration du 2026-09-13). Gel (`returning`), copie depuis le plugin,
 * vérification des images, puis insertion et bascule dans UNE transaction :
 * un échec laisse le Project gelé et les brouillons sur le disque.
 * Les copies disque ne sont pas effacées (invisibles, plus jamais lues).
 */
export async function returnProjectDrafts(project: Project, transport: DraftTransport = requestProjectDraft) {
	if (!project.serverKeyId) return;
	const state = await db.transaction(async (tx) => {
		await lockDraftProject(tx, project.id);
		const [gate] = await tx.select().from(projectDraftStorage).where(eq(projectDraftStorage.projectId, project.id));
		if (!gate || gate.state === "backend") return "backend";
		// Ancien gel vers le disque : la copie SQL n'a jamais été retirée.
		if (gate.state === "frozen") {
			await tx.update(projectDraftStorage).set({ state: "backend", updatedAt: new Date() }).where(eq(projectDraftStorage.projectId, project.id));
			return "backend";
		}
		await tx.update(projectDraftStorage).set({ state: "returning", updatedAt: new Date() }).where(eq(projectDraftStorage.projectId, project.id));
		return "returning";
	});
	if (state === "backend") return;

	const folder = projectDiskId(project);
	const listed = await transport(project.serverKeyId, { project_id: folder, owner_id: "", action: "list_all" });
	if (listed.kind !== "result" || !listed.result.ok || !Array.isArray(listed.result.drafts)) return;
	const drafts = listed.result.drafts;
	const known = drafts.length
		? new Set((await db.select({ id: users.id }).from(users).where(inArray(users.id, [...new Set(drafts.map((d) => d.ownerId))]))).map((u) => u.id))
		: new Set<string>();
	const kept = drafts.filter((d) => known.has(d.ownerId));

	const blobs: { draftId: string; hash: string; content: Uint8Array }[] = [];
	for (const draft of kept) {
		for (const meta of changedBinaryMetas(draft)) {
			const blob = await transport(project.serverKeyId, { project_id: folder, owner_id: draft.ownerId, action: "read_blob", draft_id: draft.id, hash: meta.hash });
			if (blob.kind !== "result" || !blob.result.ok || typeof blob.result.content_base64 !== "string") return;
			const content = new Uint8Array(Buffer.from(blob.result.content_base64, "base64"));
			if (content.length !== meta.size || createHash("sha256").update(content).digest("hex") !== meta.hash) return;
			blobs.push({ draftId: draft.id, hash: meta.hash, content });
		}
	}

	await db.transaction(async (tx) => {
		await lockDraftProject(tx, project.id);
		const [gate] = await tx.select().from(projectDraftStorage).where(eq(projectDraftStorage.projectId, project.id));
		if (gate?.state !== "returning") return;
		for (const draft of kept) {
			await tx.insert(projectDrafts).values({
				id: draft.id,
				projectId: project.id,
				ownerId: draft.ownerId,
				name: draft.name,
				revision: draft.revision,
				status: draft.status,
				snapshot: draft.snapshot,
				updatedBy: known.has(draft.updatedBy) ? draft.updatedBy : draft.ownerId,
				source: draft.source,
				createdAt: new Date(draft.createdAt),
				updatedAt: new Date(draft.updatedAt),
			}).onConflictDoNothing();
		}
		if (blobs.length) await tx.insert(projectDraftBlobs).values(blobs).onConflictDoNothing();
		await tx.update(projectDraftStorage).set({ state: "backend", updatedAt: new Date() }).where(eq(projectDraftStorage.projectId, project.id));
	});
}

/** Images qu'un brouillon a modifiées : seules celles-là ont des octets privés. */
function changedBinaryMetas(draft: StoredDraft) {
	const base = draft.snapshot.binaryBaseline ?? {};
	const tree = draft.snapshot.binaryTree ?? base;
	return Object.entries(tree).filter(([path, meta]) => base[path]?.hash !== meta.hash).map(([, meta]) => meta);
}

const running = new Map<string, Promise<void>>();
/** Au `hello` et au démarrage : rapatrie ce qui est encore sur le disque de ce serveur. */
export function resumeServerDrafts(serverKeyId: string): Promise<void> {
	const current = running.get(serverKeyId);
	if (current) return current;
	const task = returnServer(serverKeyId).finally(() => running.delete(serverKeyId));
	running.set(serverKeyId, task);
	return task;
}
async function returnServer(serverKeyId: string) {
	await expireDraftReceipts();
	await purgeRevokedOwners(serverKeyId);
	const pending = await db
		.select({ project: projects })
		.from(projects)
		.innerJoin(projectDraftStorage, eq(projectDraftStorage.projectId, projects.id))
		.where(and(eq(projects.serverKeyId, serverKeyId), isNull(projects.deletedAt), sql`${projectDraftStorage.state} <> 'backend'`));
	for (const { project } of pending) {
		// Un ancien gel se lève sans le plugin ; le reste attend un plugin qui sait lire ses brouillons.
		const [gate] = await db.select().from(projectDraftStorage).where(eq(projectDraftStorage.projectId, project.id));
		if (gate?.state !== "frozen" && !supportsProjectDrafts(serverKeyId)) continue;
		try { await returnProjectDrafts(project); }
		catch (error) { console.error(`[drafts] return pending for ${project.id}`, error); }
	}
}

/**
 * Les copies disque restent en place (décision B) : celles d'un compte supprimé
 * doivent quand même disparaître. Rejoué à chaque reprise, idempotent côté plugin.
 */
async function purgeRevokedOwners(serverKeyId: string) {
	if (!supportsProjectDrafts(serverKeyId)) return;
	const revoked = await db.select().from(deletedDraftOwners);
	if (!revoked.length) return;
	const roots = await db.select().from(projects).where(and(eq(projects.serverKeyId, serverKeyId), isNull(projects.deletedAt)));
	for (const project of roots) {
		for (const owner of revoked) {
			const purge = await requestProjectDraft(serverKeyId, { project_id: projectDiskId(project), owner_id: owner.ownerId, action: "purge_owner", operation_id: `purge:${owner.ownerId}` });
			if (purge.kind !== "result" || !purge.result.ok) break;
		}
	}
}
