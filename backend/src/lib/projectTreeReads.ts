import { getInstanceCount, requestProjectRead } from "../ws/hub";
import { getProjectForServer } from "./projectStorage";
import {
	announcedHash,
	confirmRead,
	generationOf,
	getSnapshot,
	markUnknown,
	mirrorSupported,
	putSnapshot,
	takeAuthor,
	type MirroredSnapshot,
} from "./snapshotMirror";

/**
 * Lire l'arbre d'un Project serveur — le seul point de passage, pour l'éditeur,
 * les assets et le resource pack.
 *
 * **Plugin `snapshot_mirror_v1`** : l'arbre vient du miroir du Snapshot tant
 * qu'il porte le hash que le plugin a annoncé (ADR
 * `snapshot-mirror-and-backend-history`). Sinon on redemande au plugin en lui
 * présentant le hash du miroir : `unchanged` le confirme sans rien transporter,
 * un arbre complet le remplace.
 *
 * **Ancien plugin** : comportement d'avant, inchangé — fusion des lectures en
 * vol et cache court (`maxAgeMs`) pour le burst d'une page qui s'affiche
 * (ADR `assets-on-server-disk`). Les échecs ne se mettent jamais en cache.
 */
type ProjectReadOutcome = Awaited<ReturnType<typeof requestProjectRead>>;

interface Entry {
	inFlight?: Promise<ProjectReadOutcome>;
	value?: ProjectReadOutcome;
	at?: number;
}

const entries = new Map<string, Entry>();
const mirrorReads = new Map<string, Promise<ProjectReadOutcome>>();

const DEFAULT_MAX_AGE_MS = 5_000;

function keyOf(serverKeyId: string, projectId: string): string {
	return `${serverKeyId} ${projectId}`;
}

export async function readProjectTree(
	serverKeyId: string,
	projectId: string,
	opts: { maxAgeMs?: number } = {},
): Promise<ProjectReadOutcome> {
	if (!mirrorSupported(serverKeyId)) {
		return getInstanceCount(serverKeyId) > 0 ? legacyRead(serverKeyId, projectId, opts) : offlineRead(serverKeyId, projectId);
	}
	const key = keyOf(serverKeyId, projectId);
	const pending = mirrorReads.get(key);
	if (pending) return pending;
	const read = mirroredRead(serverKeyId, projectId).finally(() => {
		if (mirrorReads.get(key) === read) mirrorReads.delete(key);
	});
	mirrorReads.set(key, read);
	return read;
}

function fromMirror(snapshot: MirroredSnapshot, offline = false): ProjectReadOutcome {
	const { receivedAt, ...content } = snapshot;
	return {
		kind: "result",
		result: { type: "project_read_result", request_id: "", ok: true, ...content, ...(offline ? { offline_since: receivedAt } : {}) },
	};
}

/**
 * Serveur déconnecté : la dernière copie connue, datée (ADR
 * `snapshot-mirror-and-backend-history`, décision 7). Sans copie, hors ligne.
 */
async function offlineRead(serverKeyId: string, diskId: string): Promise<ProjectReadOutcome> {
	const project = await getProjectForServer(serverKeyId, diskId);
	const snapshot = project ? await getSnapshot(project.id) : null;
	return snapshot ? fromMirror(snapshot, true) : { kind: "offline" };
}

async function mirroredRead(serverKeyId: string, diskId: string): Promise<ProjectReadOutcome> {
	const project = await getProjectForServer(serverKeyId, diskId);
	if (!project) return requestProjectRead(serverKeyId, { projectId: diskId });

	const snapshot = await getSnapshot(project.id);
	const announced = announcedHash(serverKeyId, diskId);
	if (snapshot && announced === snapshot.hash) return fromMirror(snapshot);

	const generation = generationOf(serverKeyId, diskId);
	const outcome = await requestProjectRead(serverKeyId, { projectId: diskId, ifHash: snapshot?.hash ?? null });
	if (outcome.kind !== "result" || !outcome.result.ok || !outcome.result.hash) return outcome;
	const { hash } = outcome.result;

	if (outcome.result.unchanged) {
		if (!snapshot || snapshot.hash !== hash) return requestProjectRead(serverKeyId, { projectId: diskId });
		confirmRead(serverKeyId, diskId, hash, generation);
		return fromMirror(snapshot);
	}
	await putSnapshot(project.id, {
		hash,
		files: outcome.result.files ?? [],
		binaries: outcome.result.binaries ?? [],
		failed: outcome.result.failed ?? [],
	}, { authorId: takeAuthor(serverKeyId, diskId) });
	confirmRead(serverKeyId, diskId, hash, generation);
	return outcome;
}

async function legacyRead(
	serverKeyId: string,
	projectId: string,
	opts: { maxAgeMs?: number },
): Promise<ProjectReadOutcome> {
	const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
	const key = keyOf(serverKeyId, projectId);
	const entry = entries.get(key) ?? {};

	if (entry.inFlight) return entry.inFlight;
	if (entry.value && entry.at !== undefined && Date.now() - entry.at < maxAgeMs) {
		return entry.value;
	}

	const inFlight = requestProjectRead(serverKeyId, { projectId })
		.then((outcome) => {
			const stored = entries.get(key);
			if (stored) {
				stored.inFlight = undefined;
				if (outcome.kind === "result" && outcome.result.ok) {
					stored.value = outcome;
					stored.at = Date.now();
				}
			}
			return outcome;
		})
		.catch((err) => {
			const stored = entries.get(key);
			if (stored) stored.inFlight = undefined;
			throw err;
		});

	entry.inFlight = inFlight;
	entries.set(key, entry);
	return inFlight;
}

/**
 * Oublie ce qu'on sait de cet arbre — à appeler après CHAQUE écriture qu'on
 * relaie. La fraîcheur qu'on doit à l'admin porte sur ses propres gestes.
 */
export function forgetProjectTree(serverKeyId: string, projectId: string): void {
	entries.delete(keyOf(serverKeyId, projectId));
	mirrorReads.delete(keyOf(serverKeyId, projectId));
	markUnknown(serverKeyId, projectId);
}

/** Tout oublier — pour les tests, dont le faux disque change sans passer par
 *  nos écritures. */
export function forgetAllProjectTrees(): void {
	entries.clear();
}

const warming = new Map<string, Promise<void>>();

/**
 * Remplit le miroir en tâche de fond, un Project après l'autre (au `hello` et à
 * `projects_reloaded`). Un Project déjà à jour coûte une requête SQL, pas un
 * aller-retour. Ne bloque jamais l'appelant ; un échec se relira à l'ouverture.
 */
export function warmSnapshotMirror(serverKeyId: string, diskIds: string[]): Promise<void> {
	const previous = warming.get(serverKeyId) ?? Promise.resolve();
	const next = previous.then(async () => {
		for (const diskId of diskIds) {
			if (!mirrorSupported(serverKeyId)) return;
			try {
				await readProjectTree(serverKeyId, diskId);
			} catch (error) {
				console.warn(`[snapshot-mirror] warm ${serverKeyId}/${diskId} failed`, error);
			}
		}
	});
	warming.set(serverKeyId, next);
	void next.finally(() => {
		if (warming.get(serverKeyId) === next) warming.delete(serverKeyId);
	});
	return next;
}
