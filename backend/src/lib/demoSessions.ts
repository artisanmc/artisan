import { createHash, randomBytes } from "node:crypto";
import { and, eq, gte, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { demoSessions, projects } from "../db/schema";
import { demoMinecraftVersion } from "./demoVersion";
import type { GuestPrincipal } from "./projectPrincipal";
import type { Project } from "./projectStorage";
import { DemoProjectStorage } from "./storage/DemoProjectStorage";
import { storageDatabase, storageTransaction } from "./storage/storageTransaction";

/**
 * La démo : un Project temporaire d'invité, sans compte (ADR
 * `server-only-projects`). Jetable — elle expire après 24 h sans modification
 * effective et n'en sort que par l'export. Son travail vit dans les brouillons
 * SQL (`DemoProjectStorage`) ; aucun fichier, aucun volume.
 */
export class DemoError extends Error {
	constructor(readonly code: string) {
		super(code);
	}
}
type DemoSession = typeof demoSessions.$inferSelect;
export interface DemoBootstrap {
	token: string;
	csrfToken: string;
	principal: GuestPrincipal;
	projectId: string;
	expiresAt: string;
}
const setting = (name: string, fallback: number) => {
	const value = Number(process.env[name] ?? fallback);
	if (!Number.isSafeInteger(value) || value < 1) throw new DemoError("invalid_demo_config");
	return value;
};
const ttl = () => setting("DEMO_TTL_HOURS", 24) * 3_600_000;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const csrf = (token: string) => digest(`artisan-demo-csrf:${token}`);
const validToken = (token: string) => /^[a-f0-9]{64}$/.test(token);
const bootstrap = (session: DemoSession, token: string): DemoBootstrap => ({
	token,
	csrfToken: csrf(token),
	principal: { kind: "guest", id: session.id, projectId: session.projectId },
	projectId: session.projectId,
	expiresAt: session.expiresAt.toISOString(),
});
async function globalLock() {
	await storageDatabase().execute(sql`select pg_advisory_xact_lock(hashtext('demo-global'))`);
}
async function sessionLock(id: string) {
	await storageDatabase().execute(sql`select pg_advisory_xact_lock(hashtext(${`demo:${id}`}))`);
}

export async function getDemoSessionProof(token: string) {
	if (!validToken(token)) return null;
	const session = (
		await storageDatabase().select().from(demoSessions).where(eq(demoSessions.tokenHash, digest(token)))
	)[0];
	return session ? { ...session, csrfToken: csrf(token) } : null;
}

async function activeSession(id: string, projectId?: string, database: typeof db = storageDatabase()) {
	const session = (await database.select().from(demoSessions).where(eq(demoSessions.id, id)))[0];
	if (!session || (projectId && session.projectId !== projectId)) throw new DemoError("forbidden");
	if (session.state !== "active" || session.expiresAt.getTime() <= Date.now()) throw new DemoError("demo_expired");
	const project = (await database.select().from(projects).where(eq(projects.id, session.projectId)))[0];
	if (!project || project.deletedAt || project.networkId || project.demoSessionId !== id)
		throw new DemoError("forbidden");
	return session;
}

export async function readDemoSession(token: string): Promise<DemoBootstrap | null> {
	const proof = await getDemoSessionProof(token);
	if (!proof) return null;
	return storageTransaction(async () => {
		await sessionLock(proof.id);
		try {
			return bootstrap(await activeSession(proof.id), token);
		} catch (error) {
			if (error instanceof DemoError) return null;
			throw error;
		}
	});
}

export async function authorizeDemoProject(principal: GuestPrincipal, projectId: string) {
	if (principal.projectId !== projectId) throw new DemoError("forbidden");
	return storageTransaction(async () => {
		await sessionLock(principal.id);
		return activeSession(principal.id, projectId);
	});
}

/** Octets occupés par les brouillons démo — d'un Project, ou de toutes les démos. */
async function usage(projectId?: string): Promise<number> {
	const scope = projectId
		? sql`d.project_id = ${projectId}`
		: sql`d.project_id IN (SELECT id FROM projects WHERE demo_session_id IS NOT NULL)`;
	const [row] = await db.execute<{ bytes: string | null }>(sql`
		SELECT (
			COALESCE((SELECT SUM(octet_length(d.snapshot::text)) FROM project_drafts d WHERE ${scope}), 0) +
			COALESCE((SELECT SUM(octet_length(b.content)) FROM project_draft_blobs b JOIN project_drafts d ON d.id = b.draft_id WHERE ${scope}), 0)
		)::bigint AS bytes`);
	return Number(row?.bytes ?? 0);
}

const mutations = new Map<string, number[]>();

export async function openDemoProjectStorage(principal: GuestPrincipal, project: Project) {
	await authorizeDemoProject(principal, project.id);
	return new DemoProjectStorage(project.id, principal.id, {
		async beforeMutation(incomingBytes, incomingFiles) {
			// Hors de toute transaction : le garde s'exécute après elles.
			await activeSession(principal.id, project.id, db);
			const now = Date.now();
			const recent = (mutations.get(principal.id) ?? []).filter((at) => at > now - 60_000);
			if (recent.length >= setting("DEMO_MUTATIONS_PER_MINUTE", 60)) throw new DemoError("demo_rate_limited");
			mutations.set(principal.id, [...recent, now]);
			if (
				incomingFiles > setting("DEMO_MAX_FILES", 1000) ||
				(await usage(project.id)) + incomingBytes > setting("DEMO_MAX_BYTES", 20 * 1024 * 1024)
			)
				throw new DemoError("demo_quota_exceeded");
			if ((await usage()) + incomingBytes > setting("DEMO_GLOBAL_MAX_BYTES", 512 * 1024 * 1024))
				throw new DemoError("demo_capacity_exceeded");
		},
		// Seule une modification effective prolonge la démo : lire ne la renouvelle pas.
		async afterMutation() {
			const now = Date.now();
			await db
				.update(demoSessions)
				.set({ lastActivityAt: new Date(now), expiresAt: new Date(now + ttl()) })
				.where(and(eq(demoSessions.id, principal.id), eq(demoSessions.state, "active")));
		},
	});
}

export async function createDemoSession(input: { rateKey: string }, token?: string): Promise<DemoBootstrap> {
	if (token) {
		const prior = await readDemoSession(token);
		if (prior) return prior;
	}
	const minecraftVersion = await demoMinecraftVersion();
	return storageTransaction(async (tx) => {
		await globalLock();
		const now = new Date();
		const rateKey = digest(input.rateKey);
		const recent = await tx
			.select()
			.from(demoSessions)
			.where(and(eq(demoSessions.rateKey, rateKey), gte(demoSessions.createdAt, new Date(now.getTime() - 3_600_000))));
		if (recent.length >= setting("DEMO_CREATIONS_PER_HOUR", 5)) throw new DemoError("demo_rate_limited");
		const active = await tx.select().from(demoSessions).where(eq(demoSessions.state, "active"));
		if (active.length >= setting("DEMO_MAX_SESSIONS", 1000)) throw new DemoError("demo_capacity_exceeded");
		const raw = randomBytes(32).toString("hex");
		const id = `demo_${randomBytes(16).toString("hex")}`;
		const session: DemoSession = {
			id,
			tokenHash: digest(raw),
			projectId: id,
			state: "active",
			createdAt: now,
			lastActivityAt: now,
			expiresAt: new Date(now.getTime() + ttl()),
			rateKey,
		};
		await tx.insert(demoSessions).values(session);
		await tx.insert(projects).values({
			id,
			networkId: null,
			demoSessionId: id,
			serverKeyId: null,
			storageKind: "demo",
			hostedMinecraftVersion: minecraftVersion,
			identityKind: "folder",
			name: "Welcome to Artisan",
			externalId: "demo",
			createdAt: now,
			updatedAt: now,
		});
		return bootstrap(session, raw);
	});
}

/**
 * Expire les démos inactives (le Project et ses brouillons partent en cascade)
 * et oublie après 24 h les sessions expirées, gardées d'ici là pour répondre 410.
 */
export async function maintainDemoSessions(now = Date.now()) {
	const due = await db
		.select()
		.from(demoSessions)
		.where(and(eq(demoSessions.state, "active"), lt(demoSessions.expiresAt, new Date(now))));
	for (const session of due) {
		await storageTransaction(async (tx) => {
			await sessionLock(session.id);
			const [fresh] = await tx.select().from(demoSessions).where(eq(demoSessions.id, session.id));
			if (fresh?.state !== "active" || fresh.expiresAt.getTime() > now) return;
			await tx.update(demoSessions).set({ state: "expired" }).where(eq(demoSessions.id, session.id));
			await tx.delete(projects).where(and(eq(projects.id, session.projectId), isNotNull(projects.demoSessionId)));
		});
	}
	await db
		.delete(demoSessions)
		.where(and(eq(demoSessions.state, "expired"), lt(demoSessions.expiresAt, new Date(now - 86_400_000))));
}
