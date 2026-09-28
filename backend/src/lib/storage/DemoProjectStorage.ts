import { createHash } from "node:crypto";
import demoTemplate from "../../templates/demo-project.json";
import type { DraftBody, DraftStore } from "./DraftStore";
import type { BinaryWrite, ProjectStorage, ProjectWriteBatch } from "./ProjectStorage";
import { SqlDraftStore } from "./SqlDraftStore";

/**
 * Le stockage d'un Project démo (ADR `server-only-projects`, étape 2) : rien
 * n'est jamais publié. Le contenu « publié » est le modèle de départ, fixe ; tout
 * le travail de l'invité vit dans ses brouillons SQL, et en sort par l'export.
 */
const files = Object.entries(demoTemplate as Record<string, string>)
	.sort(([a], [b]) => (a < b ? -1 : 1))
	.map(([path, content]) => ({ path, content }));
const hash = createHash("sha256").update(JSON.stringify(files)).digest("hex");
const readOnly = { kind: "result" as const, result: { ok: false, error: "write_error" as const, message: "demo_read_only" } };

/** Quotas et activité de la session, appliqués avant et après chaque mutation. */
export interface DemoGuard {
	beforeMutation(incomingBytes: number, incomingFiles: number): Promise<void>;
	afterMutation(): Promise<void>;
}

export class DemoProjectStorage implements ProjectStorage {
	readonly capabilities = Object.freeze({
		liveData: false,
		captureInGame: false,
		preview: true,
		canRename: false,
		canCopyToServer: false,
		canUseAssistant: false,
		canImport: false,
		canDelete: false,
	});
	readonly drafts: DraftStore;

	constructor(projectId: string, ownerId: string, guard: DemoGuard) {
		this.drafts = guarded(new SqlDraftStore(projectId, ownerId, this), guard);
	}

	async read(ifHash: string | null = null) {
		if (ifHash === hash) return { kind: "result" as const, result: { ok: true, unchanged: true, hash } };
		return { kind: "result" as const, result: { ok: true, hash, files, binaries: [], failed: [] } };
	}
	readAssetTree() {
		return this.read();
	}
	async write(_batch: ProjectWriteBatch) {
		return readOnly;
	}
	async readBinary(_path: string) {
		return { kind: "result" as const, result: { ok: false, error: "not_found" as const } };
	}
	async writeBinaries(_files: BinaryWrite[]) {
		return { kind: "result" as const, result: { ok: false, error: "write_error" as const, message: "demo_read_only" } };
	}
	async history(_path: string) {
		return { kind: "result" as const, result: { ok: true, versions: [] } };
	}
	async rename(operationId: string) {
		return { ok: false as const, operationId, error: "rename_unsupported" };
	}
}

const size = (body: DraftBody) => Buffer.byteLength(JSON.stringify(body));
const count = (body: DraftBody) =>
	Object.keys(body.snapshot.tree).length + Object.keys(body.snapshot.binaryTree ?? {}).length;

/** Les brouillons de l'invité, bornés : taille, nombre de fichiers, rythme. */
function guarded(store: DraftStore, guard: DemoGuard): DraftStore {
	const mutate = async <T>(bytes: number, filesCount: number, run: () => Promise<T>) => {
		await guard.beforeMutation(bytes, filesCount);
		const result = await run();
		await guard.afterMutation();
		return result;
	};
	return {
		list: () => store.list(),
		read: (id) => store.read(id),
		readBlob: (id, h) => store.readBlob(id, h),
		create: (id, op, body) => mutate(size(body), count(body), () => store.create(id, op, body)),
		update: (id, rev, op, body) => mutate(size(body), count(body), () => store.update(id, rev, op, body)),
		discard: (id, rev, op) => mutate(0, 0, () => store.discard(id, rev, op)),
		publish: async () => ({ kind: "result", result: { ok: false, error: "demo_read_only" } }),
		writeBlob: (id, rev, op, h, b64) => mutate(Math.ceil((b64.length * 3) / 4), 1, () => store.writeBlob(id, rev, op, h, b64)),
	};
}
