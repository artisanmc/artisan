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
import { buildSystemPrompt } from "./grounding";
import { runTurn } from "./loop";
import type { LlmProvider, LlmUsage } from "./provider/types";
import { WorkingCopy } from "./workingCopy";

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
	// `projectId` is the wire name since the pack→project rename; `packId` is
	// the legacy alias kept for old clients.
	r.get("/conversations", async (c) => {
		const packId = c.req.query("projectId") ?? c.req.query("packId") ?? "";
		const conversations = await listConversations(
			c.get("ownerKey") as string,
			packId,
		);
		return c.json({ conversations });
	});

	// Create an empty conversation for a workspace (seeded with the system prompt).
	r.post("/conversations", async (c) => {
		const body = await c.req
			.json()
			.catch(() => ({}) as Record<string, unknown>);
		const packId =
			typeof (body as any).projectId === "string"
				? (body as any).projectId
				: typeof (body as any).packId === "string"
					? (body as any).packId
					: "";
		const access = await resolveProjectAccess(c.get("ownerKey") as string, packId);
		if (!access.ok)
			return c.json({ error: access.error }, access.error === "project_not_found" ? 404 : 403);
		const id = await createConversation(c.get("ownerKey") as string, packId);
		return c.json({ conversationId: id });
	});

	// Fetch one conversation's full transcript (to resume it in the UI).
	r.get("/conversations/:id", async (c) => {
		const conv = await getConversation(c.req.param("id"));
		if (!conv || conv.ownerKey !== (c.get("ownerKey") as string))
			return c.json({ error: "Not found" }, 404);
		return c.json({
			id: conv.id,
			packId: conv.projectId,
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
		const pm = await resolveTurn(modelId);
		if (!pm)
			return c.json(
				{ error: "Assistant disabled: no active model/provider configured." },
				503,
			);

		// Tenant re-check on every send: guards legacy conversations created
		// before the creation-time guard existed.
		const access = await resolveProjectAccess(ownerKey, conv.projectId);
		if (!access.ok)
			return c.json({ error: access.error }, access.error === "project_not_found" ? 404 : 403);
		const networkId = access.networkId;

		const balance = await getBalance(networkId);
		if (balance <= 0)
			return c.json({ error: "insufficient_credits", balance }, 402);

		const settings = await getAiSettings();
		const actorUserId = ownerKey.slice(5);

		// Working copy is rebuilt from the live pack on every turn (last-writer-wins).
		const wc = new WorkingCopy(menus, attachments, dialogs, commands);
		const text =
			typeof (body as any).text === "string" ? (body as any).text : "";
		// The model can only discover attachments through this note: read_attachment
		// takes a file_id, but nothing else in the turn says which ids exist.
		const attachedNames = Object.keys(attachments);
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

		return streamSSE(c, async (stream) => {
			const t0 = performance.now();
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
				const message = e instanceof Error ? e.message : String(e);
				// Provider failure: log consumed tokens for admin visibility — no debit.
				await recordErrorTurn({ ...usageInput(), errorMessage: message }).catch((logErr) =>
					console.warn("[assistant] failed to record error turn:", logErr),
				);
				await stream.writeSSE({ event: "error", data: JSON.stringify({ message }) });
			} finally {
				// runTurn mutates conv.messages in place; persist the full transcript.
				await saveConversation(conv.id, conv.messages, title);
			}
		});
	});

	return r;
}
