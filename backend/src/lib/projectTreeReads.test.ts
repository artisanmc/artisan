import { beforeEach, describe, expect, mock, test } from "bun:test";

/**
 * Une lecture d'arbre par image d'aperçu, c'est ce que P6a a laissé derrière
 * elle : `GET /textures/asset/...` appelait `listDiskAssets`, donc un
 * `project_read` COMPLET par PNG affiché. Vingt glyphes sur une page = vingt
 * arbres transportés depuis le serveur Minecraft. Ce module fait de ce burst
 * une seule lecture.
 */
const calls: { serverKeyId: string; projectId: string }[] = [];
let gate: (() => void) | null = null;

mock.module("../ws/hub", () => ({
	// Ancien plugin, mais connecté : c'est le chemin d'avant.
	getInstanceCount: () => 1,
	requestProjectRead: async (serverKeyId: string, req: { projectId: string }) => {
		calls.push({ serverKeyId, projectId: req.projectId });
		if (gate) await new Promise<void>((r) => (gate = r));
		return {
			kind: "result",
			result: { ok: true, files: [{ path: "a.yaml", content: "x" }], binaries: [] },
		};
	},
}));

const { forgetProjectTree, readProjectTree } = await import("./projectTreeReads");

describe("readProjectTree", () => {
	beforeEach(() => {
		calls.length = 0;
		gate = null;
		forgetProjectTree("sk", "p");
	});

	test("un burst de lecteurs simultanés ne fait qu'UNE lecture", async () => {
		gate = () => {};
		const inFlight = Promise.all([
			readProjectTree("sk", "p"),
			readProjectTree("sk", "p"),
			readProjectTree("sk", "p"),
		]);
		// Laisse les trois appels atteindre le hub avant de débloquer la réponse.
		await Promise.resolve();
		(gate as unknown as () => void)();
		const outcomes = await inFlight;

		expect(calls.length).toBe(1);
		for (const o of outcomes) expect(o.kind).toBe("result");
	});

	test("deux Projects différents restent deux lectures", async () => {
		await readProjectTree("sk", "p");
		await readProjectTree("sk", "autre");
		expect(calls.map((c) => c.projectId)).toEqual(["p", "autre"]);
	});

	test("une lecture récente se réutilise, une lecture périmée se refait", async () => {
		await readProjectTree("sk", "p");
		await readProjectTree("sk", "p");
		expect(calls.length).toBe(1);

		await readProjectTree("sk", "p", { maxAgeMs: 0 });
		expect(calls.length).toBe(2);
	});

	/**
	 * Nos propres écritures doivent se voir tout de suite : un asset qu'on vient
	 * de poser et qui n'apparaît pas ferait recommencer l'admin.
	 */
	test("oublier l'arbre après une écriture force la relecture", async () => {
		await readProjectTree("sk", "p");
		forgetProjectTree("sk", "p");
		await readProjectTree("sk", "p");
		expect(calls.length).toBe(2);
	});

	test("un échec ne se met pas en cache", async () => {
		await readProjectTree("sk", "p");
		forgetProjectTree("sk", "p");
		expect(calls.length).toBe(1);
	});
});
