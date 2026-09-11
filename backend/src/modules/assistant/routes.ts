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
import type { LlmMessage, LlmProvider, LlmUsage } from "./provider/types";
import { mergeUploads, storeUploads, UploadError } from "./uploads";
import { withInactivityTimeout } from "./provider/activity";
import {
	SERVER_ATTACHMENT_PROVIDER_ERROR,
	redactServerAttachmentToolResults,
	resolveServerAttachments,
} from "./serverAttachments";
import { type DataSourceInfo, WorkingCopy } from "./workingCopy";
import { assistantFailureCode, startAssistantHeartbeat } from "./transport";
import { buildMigrationRouter, migrationSelection } from "./migration/routes";
import { dispatchMigration, executeMigration } from "./migration/runner";
import {
	createTask,
	type TaskEvent,
	getTask,
	latestTask,
	listTasks,
	runTask,
	stopTask,
	taskByRequest,
	taskMatchesScope,
	requeueMigrationTask,
} from "./tasks";
import { hashJsonValue } from "./migration/manifest";
import {
	getRun as getMigrationRun,
	getLatestEventCode,
	getRunContext,
	listRuns,
	transitionRun,
} from "./migration/repository";
import { MigrationInputError } from "./migration/types";
import { executeTool, type EngineEvent } from "./tools";

async function migrationStatus(runId: string): Promise<string> {
	const run = await getMigrationRun(runId);
	if (!run) throw new MigrationInputError("run_not_found");
	return JSON.stringify({
		runId,
		status: run.status,
		code: await getLatestEventCode(runId),
		canCompress: run.canCompress,
		completed: run.steps
			.filter((step) => step.status === "completed")
			.map((step) => step.targetId),
		total: run.steps.length,
		sources: run.manifest.entries.map((entry) => entry.fileId),
		instruction:
			"Legacy migration results are retained for review, not automatically applied. Use ordinary editing tools for new requests; inspect the live project and avoid recreating completed work. Legacy controls remain available in the history. Nothing is published automatically.",
	});
}

async function* migrationResult(
	runId: string,
): AsyncGenerator<EngineEvent, string> {
	const run = await getMigrationRun(runId);
	if (run?.status !== "completed") {
		const code = (await getLatestEventCode(runId)) ?? "migration_paused";
		yield { type: "error", message: code };
	}
	return migrationStatus(runId);
}

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
						for await (const event of migrationResult(runId))
							await publish(event);
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
		const incomingUploads = body.attachments;
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
		let attachments: Record<string, string>;
		try {
			attachments = mergeUploads(conv.uploadedFiles, access, incomingUploads);
		} catch (error) {
			if (error instanceof UploadError)
				return c.json({ error: error.message }, 422);
			throw error;
		}
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
		const recentMigration = background
			? (await listRuns(conv.id))[0]
			: undefined;
		const migrationContext = recentMigration
			? await getRunContext(recentMigration.id)
			: null;
		const existingMigration =
			migrationContext &&
			migrationContext.ownerKey === ownerKey &&
			migrationContext.networkId === networkId &&
			migrationContext.serverKeyId === access.serverKeyId
				? migrationContext.run
				: undefined;
		const previousMetadata =
			background && activeTask && taskMatchesScope(activeTask, access)
				? (activeTask.events as TaskEvent[]).find(
						(event) => event.type === "accepted",
					)
				: undefined;
		const requestedSelection = body.serverAttachments;
		const noNewSources =
			requestedSelection == null ||
			(Array.isArray(requestedSelection) && requestedSelection.length === 0);
		const selection =
			background && noNewSources
				? (previousMetadata?.serverAttachments ??
					(existingMigration
						? migrationSelection(existingMigration.manifest)
						: []))
				: requestedSelection;
		const serverResolved = await resolveServerAttachments(
			access.serverKeyId,
			selection,
		);
		if (!serverResolved.ok)
			return c.json({ error: serverResolved.error }, serverResolved.status);
		const allAttachments = { ...attachments, ...serverResolved.attachments };
		const serverAttachmentIds = new Set(
			Object.keys(serverResolved.attachments),
		);
		const redactAttachments = (messages: LlmMessage[]) =>
			redactServerAttachmentToolResults(
				redactServerAttachmentToolResults(messages, serverAttachmentIds),
				new Set(Object.keys(attachments)),
				"[Uploaded file content omitted from history; use read_attachment to read the current file.]",
			);
		const migrationNote = existingMigration
			? await migrationStatus(existingMigration.id)
			: "";

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
			background
				? (await listTasks(conv.id))
						.filter((task) => taskMatchesScope(task, access))
						.flatMap((task) =>
							(task.events as TaskEvent[]).filter((event) =>
								/_(written|deleted)$/.test(event.type),
							),
						)
				: [],
		);
		const baseHash = hashJsonValue({ menus, commands, dialogs, translations });
		const pendingResults =
			previousMetadata?.baseHash === baseHash && activeTask
				? (activeTask.events as TaskEvent[]).filter((event) =>
						/_(written|deleted)$/.test(event.type),
					)
				: [];
		const proposalTools: Record<string, [string, string]> = {
			menu_written: ["upsert_menu", "menu"],
			command_written: ["upsert_command", "command"],
			dialog_written: ["upsert_dialog", "dialog"],
			translations_written: ["write_translations", "entries"],
			menu_deleted: ["delete_menu", "id"],
			command_deleted: ["delete_command", "id"],
			dialog_deleted: ["delete_dialog", "id"],
		};
		for (const event of pendingResults) {
			const binding = proposalTools[event.type];
			if (
				!binding ||
				!executeTool(binding[0], { [binding[1]]: event[binding[1]] }, wc).ok
			)
				return c.json({ error: "previous_proposal_invalid" }, 409);
		}
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
					(background
						? "Explore les sources utiles avec read_attachment selon la demande et leurs dépendances. Ne prétends pas avoir converti des éléments que tu n'as pas inspectés."
						: "Lis leur contenu avec le tool read_attachment (file_id = nom exact ci-dessus) avant de répondre. Ne demande jamais à l'utilisateur de re-déposer ses fichiers."),
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
				for (const event of pendingResults)
					await stream.writeSSE({
						event: event.type,
						data: JSON.stringify(event),
					});
				for await (const ev of runTurn({
					provider: background
						? withInactivityTimeout(pm.provider)
						: pm.provider,
					model: pm.model.providerModelId,
					messages: conv.messages,
					wc,
					signal,
					activity: background,
					maxIterations: background ? 256 : undefined,
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
								await saveConversation(
									conv.id,
									redactAttachments(conv.messages),
									title,
								);
							}
						: undefined,
					system:
						buildSystemPrompt() +
						(background
							? "\nAll writes produce proposals for user review, not applied changes. Use the ordinary tools to fulfill the user's objective across menus, dialogs, commands and translations. Choose the appropriate artifact types and operation order; do not limit conversions to menus or assume a particular source plugin. Inspect relevant sources and dependencies, validate your work, repair tool errors, and explain unsupported features. Current project data is authoritative over previously proposed changes. For a continuation, consult get_previous_results: completed proposals are retained even after interruptions. Do not regenerate them unnecessarily; finish the user's remaining objective."
							: "") +
						(migrationNote
							? `\nLegacy migration history (not a workflow to execute): ${migrationNote}\nCurrently available sources via read_attachment: ${JSON.stringify(attachedNames)}. Use ordinary tools to fulfill the current request, including dialogs, commands and translations when appropriate. Do not call start_migration or resume_migration.`
							: "") +
						(pendingResults.length
							? "\nThe working copy includes the previous task's unapproved proposals because the draft is unchanged. Continue editing them with ordinary tools; the latest task carries the complete proposal set for explicit review."
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
				const code =
					e instanceof MigrationInputError ? e.code : assistantFailureCode(e);
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
				// Source bodies stay out of the transcript; uploads live in dedicated storage.
				const persistedMessages = redactAttachments(conv.messages);
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
						baseHash,
						files: attachedNames,
						serverAttachments: selection ?? [],
					},
					{ scope: access, incoming: incomingUploads },
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
				if (error instanceof UploadError)
					return c.json({ error: error.message }, 422);
				if (error instanceof Error && error.message === "task_already_running")
					return c.json({ error: error.message }, 409);
				throw error;
			}
		}
		try {
			await db.transaction((tx) =>
				storeUploads(tx, conv.id, access, incomingUploads),
			);
		} catch (error) {
			if (error instanceof UploadError)
				return c.json({ error: error.message }, 422);
			throw error;
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
