import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { resolveOwnerKey } from "../../lib/ownerKey";
import { resolveProjectAccess } from "../../lib/projectAccess";
import { getBalance } from "../ai/creditsRepo";
import { resolveModel, type AiModel } from "../ai/modelRepo";
import { computeCreditsCharged, sumUsage } from "../ai/pricing";
import { createProviderFor } from "../ai/providers";
import { getAiSettings } from "../ai/settings";
import { recordDebitedTurn, recordErrorTurn } from "../ai/usageRepo";
import {
	createConversation,
	getConversation,
	listConversations,
	saveConversation,
} from "./conversationRepo";
import { eq } from "drizzle-orm";
import { db } from "../../db/index";
import { serverDataSources } from "../../db/schema";
import { buildSystemPrompt } from "./grounding";
import { runTurn } from "./loop";
import type { LlmProvider, LlmUsage } from "./provider/types";
import {
	SERVER_ATTACHMENT_PROVIDER_ERROR,
	redactServerAttachmentToolResults,
	resolveServerAttachments,
} from "./serverAttachments";
import { type DataSourceInfo, WorkingCopy } from "./workingCopy";
import { assistantFailureCode, startAssistantHeartbeat } from "./transport";
import { buildMigrationRouter } from "./migration/routes";
import { dispatchMigration, executeMigration } from "./migration/runner";
import {
	createTask,
	getTask,
	latestTask,
	listTasks,
	runTask,
	stopTask,
	taskByRequest,
	taskMatchesScope,
	requeueMigrationTask,
} from "./tasks";
import { buildManifest, hashJsonValue } from "./migration/manifest";
import {
	createRun as createMigrationRun,
	getRun as getMigrationRun,
	getEvents as getMigrationEvents,
	transitionRun,
} from "./migration/repository";

/** Prefix marking the transient system note that lists a turn's attachments. */
export const ATTACHMENT_NOTE_PREFIX = "Fichiers joints par l'utilisateur";

let providerOverride: LlmProvider | null = null;
/** Test hook: inject a fake provider (and skip config resolution). */
export function __setProviderForTests(p: LlmProvider | null): void {
	providerOverride = p;
}

/** Model from the catalog (requested → default → fallback), provider from the
 *  model's credentials. providerOverride short-circuits the provider only —
 *  the catalog still resolves, so tests exercise real pricing. */
async function resolveTurn(
	requestedModelId?: string | null,
): Promise<{ provider: LlmProvider; model: AiModel } | null> {
	const model = await resolveModel(requestedModelId);
	if (!model) return null;
	if (providerOverride) return { provider: providerOverride, model };
	const provider = await createProviderFor(model);
	return provider ? { provider, model } : null;
}

export function buildAssistantRouter() {
	const r = new Hono<{ Variables: { ownerKey: string } }>();

	r.use("*", async (c, next) => {
		const ownerKey = await resolveOwnerKey(c);
		if (!ownerKey) return c.json({ error: "Unauthorized" }, 401);
		c.set("ownerKey", ownerKey);
		return next();
	});

	r.route(
		"/conversations/:id/migrations",
		buildMigrationRouter({
			startExecution: async (runId) => {
				const migration = await getMigrationRun(runId);
				if (!migration) throw new Error("run_not_found");
				const task = await requeueMigrationTask(
					runId,
					migration.conversationId,
				);
				if (!task) {
					dispatchMigration(runId);
					return;
				}
				void runTask(task, async (publish, signal) => {
					await publish({ type: "activity", name: "migration_resumed" });
					try {
						await executeMigration(runId, { signal, onActivity: publish });
						const result = await getMigrationRun(runId);
						if (result?.status !== "completed")
							await publish({ type: "error", code: "migration_paused" });
					} finally {
						if (signal.aborted) {
							const run = await getMigrationRun(runId);
							if (run && !["completed", "cancelled"].includes(run.status))
								await transitionRun(runId, run.revision, "cancel");
						}
					}
				}).catch(() =>
					console.warn("[assistant] task_storage_failed", { taskId: task.id }),
				);
			},
		}),
	);
	const taskRoutes = new Hono<{
		Variables: {
			ownerKey: string;
			taskScope: { networkId: string; serverKeyId: string | null };
		};
	}>();
	taskRoutes.use("*", async (c, next) => {
		const conv = await getConversation(c.req.param("id") ?? "");
		if (!conv || conv.ownerKey !== c.get("ownerKey"))
			return c.json({ error: "Not found" }, 404);
		const access = await resolveProjectAccess(conv.ownerKey, conv.projectId);
		if (!access.ok) return c.json({ error: access.error }, 403);
		c.set("taskScope", access);
		const taskId = c.req.param("taskId");
		if (taskId) {
			const task = await getTask(conv.id, taskId);
			if (!task || !taskMatchesScope(task, access))
				return c.json({ error: "Not found" }, 404);
		}
		return next();
	});
	taskRoutes.get("/", async (c) =>
		c.json({
			tasks: (await listTasks(c.req.param("id") ?? "")).filter((task) =>
				taskMatchesScope(task, c.get("taskScope")),
			),
		}),
	);
	taskRoutes.get("/:taskId", async (c) => {
		const task = await getTask(c.req.param("id") ?? "", c.req.param("taskId"));
		return task && taskMatchesScope(task, c.get("taskScope"))
			? c.json({ task })
			: c.json({ error: "Not found" }, 404);
	});
	taskRoutes.post("/:taskId/stop", async (c) => {
		const existing = await getTask(
			c.req.param("id") ?? "",
			c.req.param("taskId"),
		);
		if (!existing || !taskMatchesScope(existing, c.get("taskScope")))
			return c.json({ error: "Not found" }, 404);
		const task = await stopTask(c.req.param("id") ?? "", c.req.param("taskId"));
		return task ? c.json({ task }) : c.json({ error: "Not found" }, 404);
	});
	r.route("/conversations/:id/tasks", taskRoutes);

	// List a workspace's conversations (newest first), without message bodies.
	// `projectId` is the wire name since the project→project rename; `projectId` is
	// the legacy alias kept for old clients.
	r.get("/conversations", async (c) => {
		const projectId =
			c.req.query("projectId") ?? c.req.query("projectId") ?? "";
		const conversations = await listConversations(
			c.get("ownerKey") as string,
			projectId,
		);
		return c.json({ conversations });
	});

	// Create an empty conversation for a workspace (seeded with the system prompt).
	r.post("/conversations", async (c) => {
		const body = await c.req
			.json()
			.catch(() => ({}) as Record<string, unknown>);
		const projectId =
			typeof (body as any).projectId === "string"
				? (body as any).projectId
				: typeof (body as any).projectId === "string"
					? (body as any).projectId
					: "";
		const access = await resolveProjectAccess(
			c.get("ownerKey") as string,
			projectId,
		);
		if (!access.ok)
			return c.json(
				{ error: access.error },
				access.error === "project_not_found" ? 404 : 403,
			);
		const id = await createConversation(c.get("ownerKey") as string, projectId);
		return c.json({ conversationId: id });
	});

	// Fetch one conversation's full transcript (to resume it in the UI).
	r.get("/conversations/:id", async (c) => {
		const conv = await getConversation(c.req.param("id"));
		if (!conv || conv.ownerKey !== (c.get("ownerKey") as string))
			return c.json({ error: "Not found" }, 404);
		return c.json({
			id: conv.id,
			projectId: conv.projectId,
			title: conv.title,
			messages: conv.messages,
			updatedAt: conv.updatedAt,
		});
	});

	// Send a user message and stream the assistant's turn (SSE). The transcript
	// is persisted after the stream so the conversation can be resumed later.
	r.post("/conversations/:id/messages", async (c) => {
		const ownerKey = c.get("ownerKey") as string;
		const conv = await getConversation(c.req.param("id"));
		if (!conv || conv.ownerKey !== ownerKey)
			return c.json({ error: "Not found" }, 404);
		const body = await c.req
			.json()
			.catch(() => ({}) as Record<string, unknown>);
		const menus = Array.isArray((body as any).menus) ? (body as any).menus : [];
		const attachments =
			(body as any).attachments && typeof (body as any).attachments === "object"
				? (body as any).attachments
				: {};
		const dialogs = Array.isArray((body as any).dialogs)
			? (body as any).dialogs
			: [];
		const commands = Array.isArray((body as any).commands)
			? (body as any).commands
			: [];
		const modelId =
			typeof (body as any).modelId === "string" ? (body as any).modelId : null;

		// Tenant re-check on every send: guards legacy conversations created
		// before the creation-time guard existed.
		const access = await resolveProjectAccess(ownerKey, conv.projectId);
		if (!access.ok)
			return c.json(
				{ error: access.error },
				access.error === "project_not_found" ? 404 : 403,
			);
		const networkId = access.networkId;
		const background = body.background === true;
		const requestId = typeof body.requestId === "string" ? body.requestId : "";
		if (background && (!requestId || requestId.length > 128))
			return c.json({ error: "invalid_request_id" }, 422);
		const requestHash = hashJsonValue(body);
		if (background) {
			const existing = await taskByRequest(conv.id, requestId);
			if (existing)
				return existing.requestHash === requestHash &&
					taskMatchesScope(existing, access)
					? c.json({ task: existing }, 202)
					: c.json({ error: "request_conflict" }, 409);
		}
		const activeTask = await latestTask(conv.id);
		if (
			activeTask &&
			["queued", "running", "stopping"].includes(activeTask.status)
		)
			return c.json({ error: "task_already_running" }, 409);
		const serverResolved = await resolveServerAttachments(
			access.serverKeyId,
			(body as Record<string, unknown>).serverAttachments,
		);
		if (!serverResolved.ok) {
			return c.json({ error: serverResolved.error }, serverResolved.status);
		}
		const allAttachments = { ...attachments, ...serverResolved.attachments };
		const serverAttachmentIds = new Set(
			Object.keys(serverResolved.attachments),
		);

		const pm = await resolveTurn(modelId);
		if (!pm)
			return c.json(
				{ error: "Assistant disabled: no active model/provider configured." },
				503,
			);

		const balance = await getBalance(networkId);
		if (balance <= 0)
			return c.json({ error: "insufficient_credits", balance }, 402);

		const settings = await getAiSettings();
		const actorUserId = ownerKey.slice(5);
		// Migration: conversations created before per-turn grounding persisted the
		// grounding system prompt at index 0. Drop it — grounding is now injected
		// fresh per turn (see runTurn `system`). Guard against eating a legitimate
		// attachment-note system message (recognisable by ATTACHMENT_NOTE_PREFIX),
		// which can sit at index 0 when the very first message carried attachments.
		while (
			conv.messages[0]?.role === "system" &&
			!(
				typeof conv.messages[0].content === "string" &&
				(conv.messages[0].content as string).startsWith(ATTACHMENT_NOTE_PREFIX)
			)
		)
			conv.messages.shift();

		const translations =
			(body as any).translations &&
			typeof (body as any).translations === "object"
				? ((body as any).translations as Record<string, Record<string, string>>)
				: {};
		/*
		 * Les sources visibles depuis ce project : celles que l'éditeur envoie
		 * (les siennes) et celles qu'un module a déclarées sur le serveur.
		 *
		 * Sans elles, l'assistant ne pouvait que deviner devant un
		 * `source.ref: boutique:items` — et il a effectivement affirmé à un
		 * utilisateur que ces sources « n'étaient pas encore livrées ».
		 */
		const declared = access.serverKeyId
			? (
					await db
						.select()
						.from(serverDataSources)
						.where(eq(serverDataSources.serverKeyId, access.serverKeyId))
				).map((row) => ({
					ref: row.ref,
					moduleId: row.moduleId,
					stability: row.stability,
					keyField: row.keyField,
					fields: row.schemaJson ? safeFields(row.schemaJson) : undefined,
				}))
			: [];
		const fromEditor = Array.isArray((body as any).dataSources)
			? ((body as any).dataSources as DataSourceInfo[])
			: [];
		// Working copy is rebuilt from the live project on every turn (last-writer-wins).
		const wc = new WorkingCopy(
			menus,
			allAttachments,
			dialogs,
			commands,
			translations,
			[...fromEditor, ...declared],
		);
		const text =
			typeof (body as any).text === "string" ? (body as any).text : "";
		// The model can only discover attachments through this note: read_attachment
		// takes a file_id, but nothing else in the turn says which ids exist.
		const attachedNames = Object.keys(allAttachments);
		const messageOffset = conv.messages.length;
		if (attachedNames.length > 0) {
			conv.messages.push({
				role: "system",
				content:
					`${ATTACHMENT_NOTE_PREFIX} à ce message : ${attachedNames
						.map((n) => `\`${n}\``)
						.join(", ")}. ` +
					"Lis leur contenu avec le tool read_attachment (file_id = nom exact ci-dessus) avant de répondre. Ne demande jamais à l'utilisateur de re-déposer ses fichiers.",
			});
		}
		conv.messages.push({ role: "user", content: text });
		// Title the conversation from its first user message; an attachments-only
		// message (empty text is allowed) falls back to the file names.
		const title =
			conv.title || text.slice(0, 60) || attachedNames.join(", ").slice(0, 60);

		const correlationId = crypto.randomUUID();
		c.header("X-Assistant-Request-Id", correlationId);
		c.header("X-Accel-Buffering", "no");
		const execute = async (
			stream: {
				writeSSE: (message: { event: string; data: string }) => Promise<void>;
			},
			signal?: AbortSignal,
		) => {
			const t0 = performance.now();
			const diagnostic = (code: string) =>
				console.warn("[assistant]", {
					code,
					correlationId,
					conversationId: conv.id,
					modelId: pm.model.id,
					durationMs: Math.round(performance.now() - t0),
				});
			const usages: LlmUsage[] = [];
			const usageInput = () => ({
				networkId,
				userId: actorUserId,
				serverKeyId: null,
				model: pm.model,
				conversationId: conv.id,
				usage: sumUsage(usages),
				durationMs: Math.round(performance.now() - t0),
				promptPreview: text,
			});
			try {
				for await (const ev of runTurn({
					provider: pm.provider,
					model: pm.model.providerModelId,
					messages: conv.messages,
					wc,
					signal,
					activity: background,
					maxIterations: background ? 256 : undefined,
					migration:
						background &&
						access.serverKeyId &&
						serverAttachmentIds.size > 0 &&
						Object.keys(attachments).length === 0
							? async function* () {
									const manifest = buildManifest(serverResolved.attachments, {
										agentic: true,
										existingTargetIds: menus.map(
											(menu: { id: string }) => menu.id,
										),
									});
									const run = await createMigrationRun({
										conversationId: conv.id,
										ownerKey,
										projectId: conv.projectId,
										networkId,
										serverKeyId: access.serverKeyId!,
										modelId: pm.model.id,
										requestId: correlationId,
										requestHash: hashJsonValue(manifest),
										manifest,
										budget: {
											maxCredits: null,
											usedCredits: 0,
											contextTokens: null,
											maxOutputTokens: 4000,
										},
									});
									yield { type: "migration_started", runId: run.id };
									try {
										await transitionRun(run.id, run.revision, "start");
										await executeMigration(run.id, {
											signal,
											providerFor: async () => pm.provider,
											onActivity: async (event) => {
												await stream.writeSSE({
													event: event.type,
													data: JSON.stringify(event),
												});
											},
										});
										const result = await getMigrationRun(run.id);
										if (result?.status !== "completed") {
											const events = await getMigrationEvents(run.id);
											yield {
												type: "error",
												message: events.at(-1)?.code ?? "migration_paused",
											};
											return "Migration paused. Retain the generated proposals; resolve the reported issue before resuming.";
										}
										return "Migration completed. The generated proposals are ready for user review; nothing was published.";
									} finally {
										if (signal?.aborted) {
											const latest = await getMigrationRun(run.id);
											if (
												latest &&
												!["completed", "cancelled"].includes(latest.status)
											)
												await transitionRun(run.id, latest.revision, "cancel");
										}
									}
								}
							: undefined,
					beforeIteration: background
						? async () => {
								const current = await resolveProjectAccess(
									ownerKey,
									conv.projectId,
								);
								if (
									!current.ok ||
									current.networkId !== networkId ||
									current.serverKeyId !== access.serverKeyId
								)
									throw new Error("project_scope_changed");
								if ((await getBalance(networkId)) <= 0)
									throw new Error("insufficient_credits");
							}
						: undefined,
					system:
						buildSystemPrompt() +
						(background
							? "\nAll writes produce proposals for user review, not applied changes. For a menu migration with selected server sources, use start_migration when available instead of reimplementing the migration in chat. Current project data is authoritative over previously proposed changes."
							: ""),
				})) {
					if (ev.type === "usage") usages.push(ev.usage);
					await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
					if (
						ev.type === "usage" &&
						settings.maxCreditsPerTurn != null &&
						computeCreditsCharged(sumUsage(usages), pm.model) >=
							settings.maxCreditsPerTurn
					) {
						// Loop guard: stop cleanly after the current iteration's usage
						// lands; the consumed tokens ARE debited below.
						await stream.writeSSE({
							event: "error",
							data: JSON.stringify({ message: "turn_budget_exceeded" }),
						});
						break;
					}
				}
				const { debited, balance: newBalance } = await recordDebitedTurn(
					usageInput(),
				);
				await stream.writeSSE({
					event: "credits",
					data: JSON.stringify({ debited, balance: newBalance }),
				});
			} catch (e) {
				const code = assistantFailureCode(e);
				diagnostic(code);
				const message = code;
				// Provider failure: log consumed tokens for admin visibility — no debit.
				const persistedErrorMessage =
					serverAttachmentIds.size > 0
						? SERVER_ATTACHMENT_PROVIDER_ERROR
						: message;
				await recordErrorTurn({
					...usageInput(),
					errorMessage: persistedErrorMessage,
				}).catch(() => diagnostic("error_record_failed"));
				await stream.writeSSE({
					event: "error",
					data: JSON.stringify({ message, code, correlationId }),
				});
			} finally {
				// Server file contents are available during the turn but never retained.
				const persistedMessages = redactServerAttachmentToolResults(
					conv.messages,
					serverAttachmentIds,
				);
				await saveConversation(conv.id, persistedMessages, title).catch(() => {
					diagnostic("conversation_save_failed");
					throw new Error(`conversation_save_failed (${correlationId})`);
				});
			}
		};
		if (background) {
			try {
				const { task, created } = await createTask(
					conv.id,
					requestId,
					requestHash,
					text,
					{
						type: "accepted",
						messageOffset,
						networkId,
						serverKeyId: access.serverKeyId,
						baseHash: hashJsonValue({ menus, commands, dialogs, translations }),
						files: attachedNames,
					},
				);
				if (task.requestHash !== requestHash)
					return c.json({ error: "request_conflict" }, 409);
				if (created)
					void runTask(task, (publish, signal) =>
						execute(
							{
								writeSSE: async ({ event, data }) => {
									await publish({ ...JSON.parse(data), type: event });
								},
							},
							signal,
						),
					).catch(() =>
						console.warn("[assistant] task_storage_failed", {
							taskId: task.id,
						}),
					);
				return c.json({ task }, 202);
			} catch (error) {
				if (error instanceof Error && error.message === "task_already_running")
					return c.json({ error: error.message }, 409);
				throw error;
			}
		}
		return streamSSE(c, async (stream) => {
			const stopHeartbeat = startAssistantHeartbeat(stream, () => {});
			try {
				await execute(stream);
			} finally {
				stopHeartbeat();
			}
		});
	});

	return r;
}

/** Le schéma déclaré est du JSON stocké : illisible, on rend « pas de champs »
 *  plutôt que de faire échouer un tour d'assistant pour une source mal formée. */
function safeFields(
	raw: string,
): { name: string; type?: string }[] | undefined {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}
