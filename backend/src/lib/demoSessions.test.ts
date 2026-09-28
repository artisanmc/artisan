import { afterEach, beforeEach, expect, test } from "bun:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { demoSessions, projectDrafts, projects } from "../db/schema";
import {
	createDemoSession,
	maintainDemoSessions,
	openDemoProjectStorage,
	readDemoSession,
} from "./demoSessions";
import type { DraftSnapshot } from "./storage/DraftStore";

/**
 * La démo en base (ADR `server-only-projects`, étape 2) : un Project d'invité
 * dont rien n'est publié, dont le travail vit dans les brouillons SQL, borné et
 * jetable.
 */
const env = ["DEMO_MAX_BYTES", "DEMO_MUTATIONS_PER_MINUTE", "DEMO_CREATIONS_PER_HOUR"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(async () => {
	for (const key of env) saved[key] = process.env[key];
	await db.delete(projects).where(sql`${projects.id} LIKE 'demo_%'`);
	await db.delete(demoSessions);
});
afterEach(async () => {
	for (const key of env) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
	await db.delete(projects).where(sql`${projects.id} LIKE 'demo_%'`);
	await db.delete(demoSessions);
});

let key = 0;
const create = () => createDemoSession({ rateKey: `ip-${++key}` });
const open = async (boot: Awaited<ReturnType<typeof create>>) => {
	const [project] = await db.select().from(projects).where(eq(projects.id, boot.projectId));
	return openDemoProjectStorage(boot.principal, project!);
};
const body = (tree: Record<string, string>) => ({ name: "demo", snapshot: { baseline: {}, tree, at: 1 } as DraftSnapshot });
// `expect(promise).rejects` se bloque sous Bun sur ces rejets : on capture l'erreur.
const failure = (promise: Promise<unknown>) => promise.then(() => null, (error: { code?: string }) => error?.code);
const ok = (outcome: unknown) => (outcome as { result: { ok: boolean; error?: string } }).result;

test("a new demo is a demo Project with its template published and nothing else", async () => {
	const boot = await create();
	const [project] = await db.select().from(projects).where(eq(projects.id, boot.projectId));
	expect(project).toMatchObject({ storageKind: "demo", networkId: null, serverKeyId: null, demoSessionId: boot.principal.id });
	expect((await readDemoSession(boot.token))?.projectId).toBe(boot.projectId);

	const storage = await open(boot);
	const read = await storage.read();
	expect(read.kind === "result" && read.result.files?.map((f) => f.path)).toContain("menus/welcome.yaml");
	expect(ok(await storage.write({ files: [] })).ok).toBe(false);
});

test("the guest's work lives in its drafts, which never publish", async () => {
	const boot = await create();
	const storage = await open(boot);
	expect(ok(await storage.drafts.create("d1", "op1", body({ "menus/welcome.yaml": "mine" }))).ok).toBe(true);
	const [draft] = await db.select().from(projectDrafts).where(eq(projectDrafts.projectId, boot.projectId));
	expect(draft!.ownerId).toBe(boot.principal.id);
	expect(ok(await storage.drafts.publish("d1", 1, "op2")).error).toBe("demo_read_only");
});

test("only an effective change renews the expiry; reading does not", async () => {
	const boot = await create();
	const storage = await open(boot);
	const before = (await db.select().from(demoSessions).where(eq(demoSessions.id, boot.principal.id)))[0]!.expiresAt;
	await new Promise((r) => setTimeout(r, 15));
	await storage.read();
	await storage.drafts.list();
	expect((await db.select().from(demoSessions).where(eq(demoSessions.id, boot.principal.id)))[0]!.expiresAt).toEqual(before);
	await storage.drafts.create("d1", "op1", body({ "a.yaml": "x" }));
	expect((await db.select().from(demoSessions).where(eq(demoSessions.id, boot.principal.id)))[0]!.expiresAt.getTime()).toBeGreaterThan(before.getTime());
});

test("size and rhythm are bounded", async () => {
	const boot = await create();
	const storage = await open(boot);
	process.env.DEMO_MAX_BYTES = "2000";
	expect(await failure(storage.drafts.create("big", "op", body({ "a.yaml": "x".repeat(5000) })))).toBe("demo_quota_exceeded");

	const other = await open(await create());
	process.env.DEMO_MAX_BYTES = "100000";
	process.env.DEMO_MUTATIONS_PER_MINUTE = "2";
	await other.drafts.create("d1", "op1", body({ "a.yaml": "1" }));
	await other.drafts.update("d1", 1, "op2", body({ "a.yaml": "2" }));
	expect(await failure(other.drafts.update("d1", 2, "op3", body({ "a.yaml": "3" })))).toBe("demo_rate_limited");
});

test("creations are rate limited per origin", async () => {
	process.env.DEMO_CREATIONS_PER_HOUR = "1";
	await createDemoSession({ rateKey: "same" });
	expect(await failure(createDemoSession({ rateKey: "same" }))).toBe("demo_rate_limited");
});

test("an expired demo loses its Project and drafts, answers 410 for a while, then is forgotten", async () => {
	const boot = await create();
	const storage = await open(boot);
	await storage.drafts.create("d1", "op1", body({ "a.yaml": "x" }));
	const later = Date.now() + 25 * 3_600_000;

	await maintainDemoSessions(later);
	const [session] = await db.select().from(demoSessions).where(eq(demoSessions.id, boot.principal.id));
	expect(session!.state).toBe("expired");
	expect(await db.select().from(projects).where(eq(projects.id, boot.projectId))).toHaveLength(0);
	expect(await db.select().from(projectDrafts).where(eq(projectDrafts.projectId, boot.projectId))).toHaveLength(0);
	expect(await readDemoSession(boot.token)).toBeNull();

	await maintainDemoSessions(later + 25 * 3_600_000);
	expect(await db.select().from(demoSessions).where(eq(demoSessions.id, boot.principal.id))).toHaveLength(0);
});
