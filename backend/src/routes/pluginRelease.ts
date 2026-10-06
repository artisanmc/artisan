import { Hono } from "hono";
import { validateServerKeyHeader } from "../lib/auth";
import { pluginJarPath, readRelease, storeRelease } from "../lib/pluginRelease";

const MAX_JAR_BYTES = 64 * 1024 * 1024;

export const pluginReleaseRouter = new Hono();

pluginReleaseRouter.get("/", (c) => {
	const release = readRelease();
	return release ? c.json(release) : c.json({ error: "no_release" }, 404);
});

pluginReleaseRouter.get("/artisan.jar", async (c) => {
	if (!(await validateServerKeyHeader(c))) return c.json({ error: "unauthorized" }, 401);
	if (!readRelease()) return c.json({ error: "no_release" }, 404);
	return new Response(Bun.file(pluginJarPath()), { headers: { "Content-Type": "application/java-archive", "Cache-Control": "no-store" } });
});

// Publication par le déploiement. Pas de jeton : seul un JAR signé par la clé
// privée de la CI est accepté, et le plugin revérifie la même signature.
pluginReleaseRouter.put("/", async (c) => {
	const version = c.req.header("X-Artisan-Plugin-Version") ?? "";
	const signature = c.req.header("X-Artisan-Plugin-Signature") ?? "";
	if (Number(c.req.header("Content-Length") ?? 0) > MAX_JAR_BYTES) return c.json({ error: "too_large" }, 413);
	const bytes = new Uint8Array(await c.req.arrayBuffer());
	if (bytes.length === 0 || bytes.length > MAX_JAR_BYTES) return c.json({ error: "invalid_body" }, 400);
	const out = await storeRelease(bytes, version, signature, c.req.header("X-Artisan-Plugin-Commit") ?? null);
	if (!out.ok) return c.json({ error: out.error }, out.error === "not_newer" ? 409 : 400);
	return c.json({ version }, 201);
});
