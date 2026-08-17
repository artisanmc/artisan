import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db/index";
import { projects, serverKeys } from "../db/schema";
import { descendProjectAssets } from "../lib/assetDescent";
import { projectDiskId } from "../lib/projectStorage";
import { requestProjectRead } from "../ws/hub";

// Mounted on /api/v1/admin (app.ts), behind userAuth() + requireAdmin().

/**
 * Déclenche la **descente** des assets vers le disque des serveurs (ADR
 * `assets-on-server-disk`, P3).
 *
 * Une route plutôt qu'un script, parce que la descente doit s'exécuter là où
 * vivent les connexions WS des plugins — c'est-à-dire dans l'instance déployée,
 * pas sur un poste de dev.
 *
 * Idempotente : elle se rejoue sans dommage, et un serveur hors ligne est
 * **sauté**, pas mis en échec. C'est ce qui permet de la lancer plusieurs fois
 * jusqu'à ce que tous les serveurs soient passés.
 */
export function buildAdminAssetsRouter(): Hono {
	const r = new Hono();

	r.post("/assets/descend", async (c) => {
		const only = c.req.query("server") ?? null;
		const keys = await db
			.select()
			.from(serverKeys)
			.where(only ? eq(serverKeys.id, only) : undefined);

		const descended: string[] = [];
		const skipped: string[] = [];
		const failures: { path: string; reason: string }[] = [];

		for (const key of keys) {
			const rows = await db
				.select()
				.from(projects)
				.where(and(eq(projects.serverKeyId, key.id), isNull(projects.deletedAt)));

			for (const project of rows) {
				const diskId = projectDiskId(project);
				// Ce que le serveur porte DÉJÀ dit ce qu'il reste à faire. Muet =
				// on saute, sans rien casser ni marquer d'échec.
				const read = await requestProjectRead(key.id, { projectId: diskId });
				if (read.kind !== "result" || !read.result.ok) {
					skipped.push(`${key.id}/${diskId}`);
					continue;
				}
				const knownBinaries = Object.fromEntries(
					(read.result.binaries ?? []).map((b) => [b.path, b.hash]),
				);
				const report = await descendProjectAssets(key.id, project.id, diskId, {
					knownBinaries,
				});
				descended.push(...report.descended.map((p) => `${key.id}/${diskId} ${p}`));
				failures.push(
					...report.failures.map((f) => ({
						path: `${key.id}/${diskId} ${f.path}`,
						reason: f.reason,
					})),
				);
			}
		}

		// Ce qui a résisté est RENDU, jamais tu : une migration silencieuse qui
		// laisse des trous se découvre bien plus tard, par un menu qui n'affiche
		// rien.
		return c.json({
			ok: failures.length === 0,
			descended,
			skipped,
			failures,
		});
	});

	return r;
}
