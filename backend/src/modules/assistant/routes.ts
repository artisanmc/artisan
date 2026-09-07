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

export function buildAssistantRouter(): Hono {
	const r = new Hono();

	r.use("*", async (c, next) => {
		const ownerKey = await resolveOwnerKey(c);
		if (!ownerKey) return c.json({ error: "Unauthorized" }, 401);
		c.set("ownerKey", ownerKey);
		return next();
	});

	// List a workspace's conversations (newest first), without message bodies.
	r.route("/conversations/:id/migrations", buildMigrationRouter());
	// `projectId` is the wire name since the project→project rename; `projectId` is
	// the legacy alias kept for old clients.
	r.get("/conversations", async (c) => {
		const projectId = c.req.query("projectId") ?? c.req.query("projectId") ?? "";
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
		const access = await resolveProjectAccess(c.get("ownerKey") as string, projectId);
		if (!access.ok)
			return c.json({ error: access.error }, access.error === "project_not_found" ? 404 : 403);
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
		const dialogs = Array.isArray((body as any).dialogs) ? (body as any).dialogs : [];
		const commands = Array.isArray((body as any).commands) ? (body as any).commands : [];
		const modelId =
			typeof (body as any).modelId === "string" ? (body as any).modelId : null;

		// Tenant re-check on every send: guards legacy conversations created
		// before the creation-time guard existed.
		const access = await resolveProjectAccess(ownerKey, conv.projectId);
		if (!access.ok)
			return c.json({ error: access.error }, access.error === "project_not_found" ? 404 : 403);
		const networkId = access.networkId;
		const serverResolved = await resolveServerAttachments(
			access.serverKeyId,
			(body as Record<string, unknown>).serverAttachments,
		);
		if (!serverResolved.ok) {
			return c.json({ error: serverResolved.error }, serverResolved.status);
		}
		const allAttachments = { ...attachments, ...serverResolved.attachments };
		const serverAttachmentIds = new Set(Object.keys(serverResolved.attachments));

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
			(body as any).translations && typeof (body as any).translations === "object"
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
		const wc = new WorkingCopy(menus, allAttachments, dialogs, commands, translations, [
			...fromEditor,
			...declared,
		]);
		const text =
			typeof (body as any).text === "string" ? (body as any).text : "";
		// The model can only discover attachments through this note: read_attachment
		// takes a file_id, but nothing else in the turn says which ids exist.
		const attachedNames = Object.keys(allAttachments);
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
		return streamSSE(c, async (stream) => {
			const t0 = performance.now();
			const diagnostic = (code: string) => console.warn("[assistant]", {
				code, correlationId, conversationId: conv.id, modelId: pm.model.id,
				durationMs: Math.round(performance.now() - t0),
			});
			const stopHeartbeat = startAssistantHeartbeat(stream, () => diagnostic("client_disconnected"));
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
					system: buildSystemPrompt(),
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
				const { debited, balance: newBalance } = await recordDebitedTurn(usageInput());
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
					serverAttachmentIds.size > 0 ? SERVER_ATTACHMENT_PROVIDER_ERROR : message;
				await recordErrorTurn({
					...usageInput(),
					errorMessage: persistedErrorMessage,
				}).catch(() =>
					diagnostic("error_record_failed"),
				);
				await stream.writeSSE({ event: "error", data: JSON.stringify({ message, code, correlationId }) });
			} finally {
				stopHeartbeat();
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
		});
	});

	return r;
}

/** Le schéma déclaré est du JSON stocké : illisible, on rend « pas de champs »
 *  plutôt que de faire échouer un tour d'assistant pour une source mal formée. */
function safeFields(raw: string): { name: string; type?: string }[] | undefined {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}
