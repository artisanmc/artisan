import type { DraftSnapshot } from "./storage/DraftStore";

type Meta = { hash: string; size: number };

/**
 * Rebase un brouillon sur le Snapshot courant, fichier par fichier (ADR
 * `snapshot-mirror-and-backend-history`, décision 5) :
 * - modifié seulement sur le serveur → le brouillon prend la version serveur ;
 * - modifié des deux côtés, différemment → conflit, le brouillon garde la sienne
 *   et sa base reste l'ancienne (la publication le refusera en CAS) ;
 * - identique des deux côtés → la base avance.
 * Un chemin touché par un renommage du brouillon est à lui : on n'y touche pas.
 */
export function rebaseDraft(
	snapshot: DraftSnapshot,
	current: { files: Record<string, string>; binaries: Record<string, Meta> },
): { snapshot: DraftSnapshot; conflicts: { path: string; disk: string | null }[] } {
	const renamed = new Set((snapshot.renames ?? []).flatMap((r) => [r.from, r.to]));
	const conflicts: string[] = [];
	const text = rebaseMap(snapshot.baseline, snapshot.tree, current.files, (a, b) => a === b, renamed, conflicts);
	// Les images en conflit restent pour la publication (CAS) : pas de diff à montrer.
	const binaryConflicts: string[] = [];
	const binary = snapshot.binaryBaseline || snapshot.binaryTree
		? rebaseMap(
				snapshot.binaryBaseline ?? {},
				snapshot.binaryTree ?? snapshot.binaryBaseline ?? {},
				current.binaries,
				(a, b) => a.hash === b.hash,
				renamed,
				binaryConflicts,
			)
		: null;
	const next: DraftSnapshot = { ...snapshot, baseline: text.baseline, tree: text.tree };
	// Un brouillon sans suivi d'images laisse l'éditeur les lire au Snapshot.
	if (binary) {
		next.binaryBaseline = binary.baseline;
		next.binaryTree = binary.tree;
	}
	return { snapshot: next, conflicts: conflicts.sort().map((path) => ({ path, disk: current.files[path] ?? null })) };
}

function rebaseMap<T>(
	baseline: Record<string, T>,
	tree: Record<string, T>,
	current: Record<string, T>,
	same: (a: T, b: T) => boolean,
	renamed: Set<string>,
	conflicts: string[],
) {
	const eq = (a: T | undefined, b: T | undefined) => (a === undefined || b === undefined ? a === b : same(a, b));
	const nextBaseline = { ...baseline };
	const nextTree = { ...tree };
	for (const path of new Set([...Object.keys(baseline), ...Object.keys(tree), ...Object.keys(current)])) {
		if (renamed.has(path)) continue;
		const base = baseline[path];
		const mine = tree[path];
		const theirs = current[path];
		if (eq(base, theirs)) continue;
		if (eq(base, mine)) {
			assign(nextTree, path, theirs);
			assign(nextBaseline, path, theirs);
		} else if (eq(mine, theirs)) {
			assign(nextBaseline, path, theirs);
		} else {
			conflicts.push(path);
		}
	}
	return { baseline: nextBaseline, tree: nextTree };
}

function assign<T>(target: Record<string, T>, path: string, value: T | undefined) {
	if (value === undefined) delete target[path];
	else target[path] = value;
}
