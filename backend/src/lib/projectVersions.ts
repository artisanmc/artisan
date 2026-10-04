import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { db } from "../db";
import { projectVersions, snapshotBlobs, users } from "../db/schema";

/**
 * Lecture des Versions d'un Project serveur (ADR
 * `snapshot-mirror-and-backend-history`, décision 6). L'écriture vit dans
 * `putSnapshot` : une Version est un Snapshot reçu qui diffère du précédent.
 * Restaurer ne passe jamais par ici : l'éditeur remet le contenu dans son
 * brouillon, puis publie normalement.
 */

type Author = { id: string; name: string } | null;
type VersionRow = typeof projectVersions.$inferSelect;

async function authors(rows: VersionRow[]): Promise<Map<string, Author>> {
	const ids = [...new Set(rows.flatMap((r) => (r.authorId ? [r.authorId] : [])))];
	if (!ids.length) return new Map();
	const found = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids));
	return new Map(found.map((u) => [u.id, { id: u.id, name: u.name }]));
}

/** Chemins (textes et binaires) qui diffèrent de la Version précédente. */
const changedPaths = (next: VersionRow, previous: VersionRow | undefined) => {
	const binaries = (row: VersionRow | undefined) =>
		Object.fromEntries((row?.binaries ?? []).map((b) => [b.path, `${b.hash}:${b.size}`]));
	const differs = (a: Record<string, string>, b: Record<string, string>) =>
		[...new Set([...Object.keys(a), ...Object.keys(b)])].filter((path) => a[path] !== b[path]);
	return [...new Set([
		...differs(next.files, previous?.files ?? {}),
		...differs(binaries(next), binaries(previous)),
	])].sort();
};

export async function listVersions(projectId: string, limit = 50) {
	const rows = await db.select().from(projectVersions).where(eq(projectVersions.projectId, projectId))
		.orderBy(desc(projectVersions.createdAt)).limit(limit + 1);
	const names = await authors(rows);
	return rows.slice(0, limit).map((row, i) => ({
		id: row.id,
		hash: row.hash,
		createdAt: row.createdAt.toISOString(),
		author: row.authorId ? (names.get(row.authorId) ?? null) : null,
		changed: changedPaths(row, rows[i + 1]),
	}));
}

export async function readVersion(projectId: string, versionId: string) {
	const [row] = await db.select().from(projectVersions)
		.where(and(eq(projectVersions.projectId, projectId), eq(projectVersions.id, versionId)));
	if (!row) return null;
	// La Version d'avant, pour que l'éditeur montre ce que celle-ci a changé.
	const [previous] = await db.select({ id: projectVersions.id }).from(projectVersions)
		.where(and(eq(projectVersions.projectId, projectId), lt(projectVersions.createdAt, row.createdAt)))
		.orderBy(desc(projectVersions.createdAt)).limit(1);
	const hashes = [...new Set(Object.values(row.files))];
	const blobs = hashes.length ? await db.select().from(snapshotBlobs).where(inArray(snapshotBlobs.hash, hashes)) : [];
	const byHash = new Map(blobs.map((b) => [b.hash, b.content]));
	const files = Object.entries(row.files)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.flatMap(([path, hash]) => (byHash.has(hash) ? [{ path, content: byHash.get(hash)! }] : []));
	return {
		id: row.id,
		hash: row.hash,
		createdAt: row.createdAt.toISOString(),
		previousId: previous?.id ?? null,
		files,
		binaries: row.binaries,
	};
}

/**
 * Les contenus passés d'un fichier, le plus récent d'abord, sans le contenu
 * actuel — la même forme que l'ancienne corbeille disque. `null` quand le
 * Project n'a encore aucune Version : l'appelant retombe sur le plugin.
 */
export async function fileHistory(projectId: string, path: string, limit = 20) {
	const rows = await db.select().from(projectVersions).where(eq(projectVersions.projectId, projectId))
		.orderBy(desc(projectVersions.createdAt));
	if (!rows.length) return null;
	const names = await authors(rows);
	const past: { at: number; hash: string; author: Author }[] = [];
	const authorOf = (row: VersionRow) => (row.authorId ? (names.get(row.authorId) ?? null) : null);
	let newer = rows[0]!.files[path];
	for (const row of rows.slice(1)) {
		const hash = row.files[path];
		const last = past[past.length - 1];
		if (hash !== undefined && hash !== newer) {
			if (past.length >= limit) break;
			past.push({ at: row.createdAt.getTime(), hash, author: authorOf(row) });
		} else if (hash !== undefined && last?.hash === hash) {
			// Même contenu plus ancien : la Version qui l'a introduit est plus loin.
			last.at = row.createdAt.getTime();
			last.author = authorOf(row);
		}
		newer = hash;
	}
	const blobs = past.length ? await db.select().from(snapshotBlobs).where(inArray(snapshotBlobs.hash, [...new Set(past.map((p) => p.hash))])) : [];
	const byHash = new Map(blobs.map((b) => [b.hash, b.content]));
	return past.flatMap((p) => (byHash.has(p.hash) ? [{ at: p.at, content: byHash.get(p.hash)!, author: p.author }] : []));
}
