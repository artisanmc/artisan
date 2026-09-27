import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "../db";
import { projects, projectSnapshots, projectVersions, snapshotBlobs, users } from "../db/schema";

/**
 * Le miroir du Snapshot d'un Project serveur (ADR
 * `snapshot-mirror-and-backend-history`, décisions 1 à 3).
 *
 * Deux moitiés distinctes :
 * - **le contenu**, en base, adressé par hash — jetable, jamais une autorité ;
 * - **la validité**, en mémoire : le dernier hash que le plugin a annoncé. Le
 *   miroir ne sert que s'il porte exactement celui-là. Rien d'annoncé (plugin
 *   déconnecté, ancien JAR, écriture en cours) = on redemande au plugin.
 */

export interface MirroredSnapshot {
	hash: string;
	files: { path: string; content: string }[];
	binaries: { path: string; hash: string; size: number }[];
	failed: { path: string; reason: string }[];
	/** Quand le backend l'a reçu — sert à dater un Project ouvert serveur éteint. */
	receivedAt?: string;
}

const blobHash = (content: string) => createHash("sha256").update(content, "utf8").digest("hex");

/**
 * Range le Snapshot ; s'il diffère de la dernière Version, il en devient une
 * (décision 6). `authorId` = qui a publié ; absent = le serveur (reload).
 */
export async function putSnapshot(projectId: string, snapshot: MirroredSnapshot, opts: { authorId?: string | null } = {}): Promise<void> {
	const manifest: Record<string, string> = {};
	const blobs = new Map<string, string>();
	for (const file of snapshot.files) {
		const hash = blobHash(file.content);
		manifest[file.path] = hash;
		blobs.set(hash, file.content);
	}
	const row = {
		hash: snapshot.hash,
		files: manifest,
		binaries: snapshot.binaries,
		failed: snapshot.failed,
		receivedAt: new Date(),
	};
	await db.transaction(async (tx) => {
		if (blobs.size > 0) {
			await tx
				.insert(snapshotBlobs)
				.values([...blobs].map(([hash, content]) => ({ hash, content })))
				.onConflictDoNothing();
		}
		await tx
			.insert(projectSnapshots)
			.values({ projectId, ...row })
			.onConflictDoUpdate({ target: projectSnapshots.projectId, set: row });
		// Le plugin porte ce Project : il existe désormais sur le disque.
		await tx.update(projects).set({ unpublished: false }).where(and(eq(projects.id, projectId), eq(projects.unpublished, true)));
		const [latest] = await tx.select({ hash: projectVersions.hash }).from(projectVersions)
			.where(eq(projectVersions.projectId, projectId)).orderBy(desc(projectVersions.createdAt)).limit(1);
		if (latest?.hash !== snapshot.hash) {
			const author = opts.authorId
				? (await tx.select({ id: users.id }).from(users).where(eq(users.id, opts.authorId)))[0]?.id ?? null
				: null;
			await tx.insert(projectVersions).values({
				id: crypto.randomUUID(),
				projectId,
				hash: snapshot.hash,
				files: manifest,
				binaries: snapshot.binaries,
				authorId: author,
				createdAt: row.receivedAt,
			});
		}
	});
}

export async function getSnapshot(projectId: string): Promise<MirroredSnapshot | null> {
	const [row] = await db.select().from(projectSnapshots).where(eq(projectSnapshots.projectId, projectId));
	if (!row) return null;
	const hashes = [...new Set(Object.values(row.files))];
	const blobs = hashes.length
		? await db.select().from(snapshotBlobs).where(inArray(snapshotBlobs.hash, hashes))
		: [];
	const byHash = new Map(blobs.map((b) => [b.hash, b.content]));
	const files: MirroredSnapshot["files"] = [];
	for (const [path, hash] of Object.entries(row.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
		const content = byHash.get(hash);
		// Un blob manquant rend le miroir inutilisable, pas faux : on relira.
		if (content === undefined) return null;
		files.push({ path, content });
	}
	return { hash: row.hash, files, binaries: row.binaries, failed: row.failed, receivedAt: row.receivedAt.toISOString() };
}

/** Ids disque des Projects jamais publiés de ce serveur (ADR `server-only-projects`). */
export async function unpublishedProjectIds(serverKeyId: string): Promise<string[]> {
	const rows = await db.select({ id: projects.id, externalId: projects.externalId }).from(projects)
		.where(and(eq(projects.serverKeyId, serverKeyId), eq(projects.unpublished, true), isNull(projects.deletedAt)));
	return rows.map((r) => r.externalId ?? r.id).sort();
}

/** Première écriture réussie : le dossier existe sur le disque. */
export async function markPublished(projectId: string): Promise<void> {
	await db.update(projects).set({ unpublished: false }).where(and(eq(projects.id, projectId), eq(projects.unpublished, true)));
}

/** Ids disque des Projects de ce serveur dont le backend a une copie — pour le lister éteint. */
export async function mirroredProjectIds(serverKeyId: string): Promise<string[]> {
	const rows = await db.select({ id: projects.id, externalId: projects.externalId }).from(projects)
		.innerJoin(projectSnapshots, eq(projectSnapshots.projectId, projects.id))
		.where(and(eq(projects.serverKeyId, serverKeyId), isNull(projects.deletedAt)));
	return rows.map((r) => r.externalId ?? r.id).sort();
}

// ── Validité ────────────────────────────────────────────────────────────────

interface ServerState {
	/** Les Projects du Snapshot, tels que le dernier hello/reload les a listés. */
	listed: string[];
	announced: Map<string, string>;
	/** Bumpé à chaque écriture : une lecture partie avant ne valide rien. */
	generation: Map<string, number>;
}

const servers = new Map<string, ServerState>();

/** `hello` d'un plugin qui annonce `snapshot_mirror_v1` : l'état repart de ses hashes. */
export function recordHello(serverKeyId: string, hashes: { id: string; hash: string }[]): void {
	const state: ServerState = { listed: sortedIds(hashes), announced: new Map(), generation: servers.get(serverKeyId)?.generation ?? new Map() };
	for (const { id, hash } of hashes) state.announced.set(id, hash);
	servers.set(serverKeyId, state);
}

/** `projects_reloaded` : ne fait foi que pour un serveur qui a annoncé la capacité. */
export function recordReload(serverKeyId: string, hashes: { id: string; hash: string }[]): void {
	const state = servers.get(serverKeyId);
	if (!state) return;
	state.listed = sortedIds(hashes);
	for (const { id, hash } of hashes) state.announced.set(id, hash);
}

const sortedIds = (hashes: { id: string }[]) => hashes.map((h) => h.id).sort();

/** Ce que `project_list` rendrait — `null` quand le plugin n'a pas annoncé la capacité. */
export function listedProjects(serverKeyId: string): string[] | null {
	return servers.get(serverKeyId)?.listed.slice() ?? null;
}

export function mirrorSupported(serverKeyId: string): boolean {
	return servers.has(serverKeyId);
}

export function announcedHash(serverKeyId: string, diskId: string): string | undefined {
	return servers.get(serverKeyId)?.announced.get(diskId);
}

export function generationOf(serverKeyId: string, diskId: string): number {
	return servers.get(serverKeyId)?.generation.get(diskId) ?? 0;
}

/** Une lecture via le plugin fait foi — sauf si une écriture l'a doublée entre-temps. */
export function confirmRead(serverKeyId: string, diskId: string, hash: string, generation: number): void {
	const state = servers.get(serverKeyId);
	if (!state || generationOf(serverKeyId, diskId) !== generation) return;
	state.announced.set(diskId, hash);
}

/** Après une écriture relayée : on ne sait plus, la prochaine lecture ira au plugin. */
export function markUnknown(serverKeyId: string, diskId: string): void {
	const state = servers.get(serverKeyId);
	if (!state) return;
	state.announced.delete(diskId);
	state.generation.set(diskId, generationOf(serverKeyId, diskId) + 1);
}

const authors = new Map<string, string>();

/** Une écriture de l'éditeur a réussi : le prochain Snapshot de ce Project lui revient. */
export function noteAuthor(serverKeyId: string, diskId: string, userId: string): void {
	authors.set(`${serverKeyId} ${diskId}`, userId);
}

export function takeAuthor(serverKeyId: string, diskId: string): string | null {
	const key = `${serverKeyId} ${diskId}`;
	const userId = authors.get(key) ?? null;
	authors.delete(key);
	return userId;
}

/** Déconnexion, éviction, ou `hello` sans la capacité. */
export function forgetServer(serverKeyId: string): void {
	servers.delete(serverKeyId);
}

export function forgetAllServersForTesting(): void {
	servers.clear();
	authors.clear();
}
