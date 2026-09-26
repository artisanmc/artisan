import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { projectSnapshots, snapshotBlobs } from "../db/schema";

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
}

const blobHash = (content: string) => createHash("sha256").update(content, "utf8").digest("hex");

export async function putSnapshot(projectId: string, snapshot: MirroredSnapshot): Promise<void> {
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
	return { hash: row.hash, files, binaries: row.binaries, failed: row.failed };
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

/** Déconnexion, éviction, ou `hello` sans la capacité. */
export function forgetServer(serverKeyId: string): void {
	servers.delete(serverKeyId);
}

export function forgetAllServersForTesting(): void {
	servers.clear();
}
