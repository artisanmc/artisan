// Phase 3 du cache éditeur : le plugin annonce ses rechargements.
//
// Une édition faite à la main sur le disque ne compte qu'au reload — l'éditeur
// n'avait donc aucun moyen d'apprendre que ce moment était arrivé. Le plugin
// l'annonce, le backend oublie ce qu'il savait de l'arbre et relaie aux
// éditeurs connectés à CE serveur.
import { beforeEach, describe, expect, mock, test } from "bun:test";

const treeReads: string[] = [];
mock.module("../lib/projectTreeReads", () => ({
	forgetProjectTree: (serverKeyId: string, projectId: string) => {
		treeReads.push(`${serverKeyId}/${projectId}`);
	},
	readProjectTree: async () => ({ kind: "offline" }),
	forgetAllProjectTrees: () => {},
}));

const {
	cleanupEditorConn,
	connToServerId,
	connSenders,
	handlePluginMessage,
	registerConn,
	registerEditorConn,
} = await import("./hub");

describe("projects_reloaded", () => {
	beforeEach(() => {
		treeReads.length = 0;
	});

	test("le backend oublie l'arbre des Projects rechargés", async () => {
		registerConn("conn-reload", () => {});
		connToServerId.set("conn-reload", "sk_reload");
		try {
			await handlePluginMessage(
				"conn-reload",
				JSON.stringify({
					type: "projects_reloaded",
					projects: [
						{ id: "boutique", hash: "h1" },
						{ id: "hub", hash: "h2" },
					],
				}),
			);
			expect(treeReads).toEqual(["sk_reload/boutique", "sk_reload/hub"]);
		} finally {
			connSenders.delete("conn-reload");
			connToServerId.delete("conn-reload");
		}
	});

	test("les éditeurs de CE serveur sont prévenus, avec les empreintes", async () => {
		registerConn("conn-reload-2", () => {});
		connToServerId.set("conn-reload-2", "sk_a");
		const received: string[] = [];
		registerEditorConn("sess-a", "sk_a", (m) => received.push(m));
		const otherServer: string[] = [];
		registerEditorConn("sess-b", "sk_b", (m) => otherServer.push(m));
		try {
			await handlePluginMessage(
				"conn-reload-2",
				JSON.stringify({
					type: "projects_reloaded",
					projects: [{ id: "boutique", hash: "h1" }],
				}),
			);

			expect(received.length).toBe(1);
			const payload = JSON.parse(received[0]!);
			expect(payload.type).toBe("projects_reloaded");
			expect(payload.server_key_id).toBe("sk_a");
			expect(payload.projects).toEqual([{ id: "boutique", hash: "h1" }]);
			// Un éditeur branché sur un AUTRE serveur n'a rien à revalider.
			expect(otherServer.length).toBe(0);
		} finally {
			cleanupEditorConn("sess-a");
			cleanupEditorConn("sess-b");
			connSenders.delete("conn-reload-2");
			connToServerId.delete("conn-reload-2");
		}
	});

	test("une annonce d'une connexion non identifiée ne fait rien", async () => {
		registerConn("conn-anonyme", () => {});
		try {
			await handlePluginMessage(
				"conn-anonyme",
				JSON.stringify({ type: "projects_reloaded", projects: [{ id: "boutique", hash: "h" }] }),
			);
			expect(treeReads).toEqual([]);
		} finally {
			connSenders.delete("conn-anonyme");
		}
	});
});
