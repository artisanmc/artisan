import { eq } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { db } from "../../../db";
import { projects } from "../../../db/schema";
import { resolveProjectAccess } from "../../../lib/projectAccess";
import { getBalance } from "../../ai/creditsRepo";
import { getModel } from "../../ai/modelRepo";
import { createProviderFor } from "../../ai/providers";
import { getConversation } from "../conversationRepo";
import {
	type ImportSourcesReadFn,
	resolveServerAttachments,
} from "../serverAttachments";
import {
	buildManifest,
	hashJsonValue,
	verifyManifestSources,
} from "./manifest";
import {
	type MigrationAction,
	blockRun,
	createRun,
	getEvents,
	getProposals,
	getRun,
	getRunByRequest,
	getRunContext,
	listRuns,
	recoverExpiredRun,
	transitionRun,
} from "./repository";
import { MigrationInputError, type MigrationManifest } from "./types";

export interface MigrationRouteDependencies {
	readSources?: ImportSourcesReadFn;
	modelAvailable?: (
		model: NonNullable<Awaited<ReturnType<typeof getModel>>>,
	) => Promise<boolean>;
	/** Must dispatch detached work; it must not wait for provider completion. */
	startExecution?: (runId: string) => void;
}

export type MigrationRouteEnv = {
	Variables: {
		ownerKey: string;
		migrationConversation: NonNullable<
			Awaited<ReturnType<typeof getConversation>>
		>;
		migrationAccess: { networkId: string; serverKeyId: string };
	};
};

export function migrationSelection(manifest: MigrationManifest) {
	const groups = new Map<string, string[]>();
	for (const entry of manifest.entries)
		groups.set(entry.sourceId, [
			...(groups.get(entry.sourceId) ?? []),
			entry.path,
		]);
	return [...groups].map(([sourceId, paths]) => ({ sourceId, paths }));
}

export function buildMigrationRouter(
	deps: MigrationRouteDependencies = {},
): Hono<MigrationRouteEnv> {
	const r = new Hono<MigrationRouteEnv>();
	r.onError((error, c) => {
		if (error instanceof MigrationInputError)
			return c.json(
				{ error: error.code },
				[
					"revision_conflict",
					"request_conflict",
					"invalid_transition",
					"migration_budget_exceeded",
					"step_in_flight",
				].includes(error.code)
					? 409
					: 422,
			);
		return c.json({ error: "migration_error" }, 500);
	});
	r.use("*", async (c, next) => {
		const ownerKey = c.get("ownerKey") as string | undefined;
		if (!ownerKey) return c.json({ error: "unauthorized" }, 401);
		const conversation = await getConversation(c.req.param("id") ?? "");
		if (!conversation || conversation.ownerKey !== ownerKey)
			return c.json({ error: "not_found" }, 404);
		const access = await resolveProjectAccess(ownerKey, conversation.projectId);
		if (!access.ok)
			return c.json(
				{ error: access.error },
				access.error === "project_not_found" ? 404 : 403,
			);
		const [project] = await db
			.select({ deletedAt: projects.deletedAt })
			.from(projects)
			.where(eq(projects.id, conversation.projectId));
		if (!project || project.deletedAt)
			return c.json({ error: "project_not_found" }, 404);
		c.set("migrationConversation", conversation);
		c.set("migrationAccess", access);
		return next();
	});
	const guardRun: MiddlewareHandler<MigrationRouteEnv> = async (c, next) => {
		const conversation = c.get("migrationConversation");
		const access = c.get("migrationAccess");
		const ownerKey = c.get("ownerKey");
		const runId = c.req.param("runId");
		if (runId) {
			const context = await getRunContext(runId);
			if (
				!context ||
				context.ownerKey !== ownerKey ||
				context.run.conversationId !== conversation.id
			)
				return c.json({ error: "not_found" }, 404);
			if (
				context.networkId !== access.networkId ||
				context.serverKeyId !== access.serverKeyId ||
				context.run.projectId !== conversation.projectId
			)
				return c.json({ error: "project_scope_changed" }, 409);
			await recoverExpiredRun(runId);
		}
		return next();
	};
	r.use("/:runId", guardRun);
	r.use("/:runId/*", guardRun);
	r.get("/", async (c) => {
		const access = c.get("migrationAccess");
		const candidates = await listRuns(c.req.param("id") ?? "");
		const visible = [];
		for (const run of candidates) {
			const context = await getRunContext(run.id);
			if (
				context?.networkId === access.networkId &&
				context.serverKeyId === access.serverKeyId &&
				context.ownerKey === c.get("ownerKey")
			)
				visible.push(run);
		}
		return c.json({ runs: visible });
	});
	r.post("/", async (c) => {
		const body = await c.req.json<Record<string, unknown>>().catch(() => null);
		if (
			!body ||
			typeof body.requestId !== "string" ||
			!/^[a-zA-Z0-9_-]{1,128}$/.test(body.requestId) ||
			typeof body.modelId !== "string" ||
			body.modelId.length > 128 ||
			typeof body.maxCredits !== "number" ||
			!Number.isSafeInteger(body.maxCredits) ||
			body.maxCredits <= 0 ||
			body.maxCredits > 1_000_000 ||
			!Array.isArray(body.existingTargetIds) ||
			body.existingTargetIds.length > 10000 ||
			body.existingTargetIds.some(
				(id) => typeof id !== "string" || id.length > 128,
			)
		)
			return c.json({ error: "invalid_input" }, 422);
		if (
			body.targetIds !== undefined &&
			(!body.targetIds ||
				typeof body.targetIds !== "object" ||
				Array.isArray(body.targetIds) ||
				Object.keys(body.targetIds).length > 200 ||
				Object.entries(body.targetIds).some(
					([key, value]) =>
						key.length > 1200 ||
						typeof value !== "string" ||
						value.length > 128,
				))
		)
			return c.json({ error: "invalid_input" }, 422);
		const contextTokens = body.contextTokens ?? 64000;
		const maxOutputTokens = body.maxOutputTokens ?? 8000;
		if (
			typeof contextTokens !== "number" ||
			!Number.isSafeInteger(contextTokens) ||
			contextTokens < 4096 ||
			contextTokens > 128000 ||
			typeof maxOutputTokens !== "number" ||
			!Number.isSafeInteger(maxOutputTokens) ||
			maxOutputTokens < 256 ||
			maxOutputTokens > 16000 ||
			maxOutputTokens >= contextTokens
		)
			return c.json({ error: "invalid_context_budget" }, 422);
		const requestHash = hashJsonValue({
			modelId: body.modelId,
			maxCredits: body.maxCredits,
			serverAttachments: body.serverAttachments ?? null,
			existingTargetIds: body.existingTargetIds,
			targetIds: body.targetIds ?? {},
			contextTokens,
			maxOutputTokens,
		});
		const conversationId = c.req.param("id") ?? "";
		const existing = await getRunByRequest(conversationId, body.requestId);
		if (existing) {
			const context = await getRunContext(existing.run.id);
			const access = c.get("migrationAccess");
			if (
				!context ||
				context.networkId !== access.networkId ||
				context.serverKeyId !== access.serverKeyId ||
				context.ownerKey !== c.get("ownerKey")
			)
				return c.json({ error: "project_scope_changed" }, 409);
			if (existing.requestHash !== requestHash)
				return c.json({ error: "request_conflict" }, 409);
			return c.json({ run: existing.run });
		}
		const model = await getModel(body.modelId);
		if (
			!model?.isActive ||
			!(await (deps.modelAvailable
				? deps.modelAvailable(model)
				: createProviderFor(model)))
		)
			return c.json({ error: "model_unavailable" }, 503);
		const access = c.get("migrationAccess") as {
			networkId: string;
			serverKeyId: string;
		};
		const sources = await resolveServerAttachments(
			access.serverKeyId,
			body.serverAttachments,
			deps.readSources,
		);
		if (!sources.ok) return c.json({ error: sources.error }, sources.status);
		const manifest = buildManifest(sources.attachments, {
			existingTargetIds: body.existingTargetIds as string[],
			targetIds: body.targetIds as Record<string, string> | undefined,
		});
		if (!manifest.entries.some((entry) => entry.kind === "menu"))
			return c.json({ error: "no_menus_selected" }, 422);
		const conversation = await getConversation(conversationId);
		if (!conversation) return c.json({ error: "not_found" }, 404);
		const run = await createRun({
			conversationId,
			projectId: conversation.projectId,
			ownerKey: c.get("ownerKey") as string,
			...access,
			modelId: model.id,
			requestId: body.requestId,
			requestHash,
			manifest,
			budget: {
				maxCredits: body.maxCredits,
				usedCredits: 0,
				contextTokens,
				maxOutputTokens,
			},
		});
		return c.json({ run }, 201);
	});
	r.get("/:runId", async (c) =>
		c.json({ run: await getRun(c.req.param("runId")) }),
	);
	r.get("/:runId/proposals", async (c) =>
		c.json({ proposals: await getProposals(c.req.param("runId")) }),
	);
	r.get("/:runId/events", async (c) => {
		const after = Number(c.req.query("after") ?? 0);
		const limit = Number(c.req.query("limit") ?? 100);
		if (
			!Number.isSafeInteger(after) ||
			after < 0 ||
			!Number.isSafeInteger(limit) ||
			limit < 1 ||
			limit > 200
		)
			return c.json({ error: "invalid_input" }, 422);
		return c.json({
			events: await getEvents(c.req.param("runId"), after, limit),
		});
	});
	for (const action of [
		"start",
		"resume",
		"pause",
		"cancel",
	] as MigrationAction[])
		r.post(`/:runId/${action}`, async (c) => {
			const body = await c.req
				.json<Record<string, unknown>>()
				.catch(() => null);
			if (
				!body ||
				typeof body.expectedRevision !== "number" ||
				!Number.isSafeInteger(body.expectedRevision) ||
				body.expectedRevision < 0
			)
				return c.json({ error: "invalid_input" }, 422);
			const run = await getRun(c.req.param("runId"));
			if (!run) return c.json({ error: "not_found" }, 404);
			if (body.expectedRevision !== run.revision)
				return c.json({ error: "revision_conflict", run }, 409);
			if (action === "start" || action === "resume") {
				if (!deps.startExecution)
					return c.json({ error: "migration_runner_unavailable" }, 503);
				const model = await getModel(run.modelId);
				if (
					!model?.isActive ||
					!(await (deps.modelAvailable
						? deps.modelAvailable(model)
						: createProviderFor(model)))
				)
					return c.json({ error: "model_unavailable" }, 503);
				const access = c.get("migrationAccess") as {
					networkId: string;
					serverKeyId: string;
				};
				if ((await getBalance(access.networkId)) <= 0)
					return c.json({ error: "insufficient_credits" }, 402);
				const sources = await resolveServerAttachments(
					access.serverKeyId,
					migrationSelection(run.manifest),
					deps.readSources,
				);
				if (!sources.ok)
					return c.json({ error: sources.error }, sources.status);
				const issues = verifyManifestSources(run.manifest, sources.attachments);
				if (issues.length)
					return c.json(
						{
							error: issues[0].code,
							run: await blockRun(run.id, run.revision, issues[0].code),
						},
						409,
					);
			}
			const updated = await transitionRun(run.id, run.revision, action);
			if (action === "start" || action === "resume") {
				try {
					deps.startExecution?.(run.id);
				} catch {
					return c.json(
						{
							error: "migration_dispatch_failed",
							run: await transitionRun(run.id, updated.revision, "pause"),
						},
						503,
					);
				}
			}
			return c.json({ run: updated });
		});
	return r;
}
