import type { Context } from "hono";
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { validateAccessToken } from "../../lib/auth";
import { findSession } from "../../lib/sessionManager";
import {
	createConversation,
	getConversation,
	listConversations,
	saveConversation,
} from "./conversationRepo";
import { runTurn } from "./loop";
import { createProvider } from "./provider/config";
import { loadAssistantProviderConfig } from "./provider/dbConfig";
import type { LlmProvider } from "./provider/types";
import { WorkingCopy } from "./workingCopy";

let providerOverride: LlmProvider | null = null;
/** Test hook: inject a fake provider (and skip config resolution). */
export function __setProviderForTests(p: LlmProvider | null): void {
	providerOverride = p;
}

async function resolve(): Promise<{
	provider: LlmProvider;
	model: string;
} | null> {
	if (providerOverride)
		return { provider: providerOverride, model: "test-model" };
	const cfg = await loadAssistantProviderConfig();
	return cfg ? { provider: createProvider(cfg), model: cfg.model } : null;
}

/**
 * The assistant panel lives in the user-auth web editor, so the common path is
 * the user-session cookie; the editor-session Bearer token covers the
 * plugin-initiated trust-dance flow. Accept either and return an owner key
 * (`sk:<serverKeyId>` or `user:<userId>`) that scopes conversations per tenant.
 */
async function resolveOwnerKey(c: Context): Promise<string | null> {
	const h = c.req.header("Authorization");
	const bearer = h?.startsWith("Bearer ") ? h.slice(7) : "";
	if (bearer) {
		const session = await validateAccessToken(bearer);
		if (session) return `sk:${session.serverKeyId}`;
	}
	const sessionId = getCookie(c, "artisan_user_session");
	if (sessionId) {
		const us = await findSession(sessionId);
		if (us) return `user:${us.userId}`;
	}
	return null;
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
	r.get("/conversations", async (c) => {
		const packId = c.req.query("packId") ?? "";
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
			typeof (body as any).packId === "string" ? (body as any).packId : "";
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
			packId: conv.packId,
			title: conv.title,
			messages: conv.messages,
			updatedAt: conv.updatedAt,
		});
	});

	// Send a user message and stream the assistant's turn (SSE). The transcript
	// is persisted after the stream so the conversation can be resumed later.
	r.post("/conversations/:id/messages", async (c) => {
		const conv = await getConversation(c.req.param("id"));
		if (!conv || conv.ownerKey !== (c.get("ownerKey") as string))
			return c.json({ error: "Not found" }, 404);
		const body = await c.req
			.json()
			.catch(() => ({}) as Record<string, unknown>);
		const menus = Array.isArray((body as any).menus) ? (body as any).menus : [];
		const attachments =
			(body as any).attachments && typeof (body as any).attachments === "object"
				? (body as any).attachments
				: {};
		const pm = await resolve();
		if (!pm)
			return c.json(
				{
					error:
						"Assistant disabled: no provider configured (set ASSISTANT_API_KEY).",
				},
				503,
			);

		// Working copy is rebuilt from the live pack on every turn (last-writer-wins).
		const wc = new WorkingCopy(menus, attachments);
		const text =
			typeof (body as any).text === "string" ? (body as any).text : "";
		conv.messages.push({ role: "user", content: text });
		// Title the conversation from its first user message.
		const title = conv.title || text.slice(0, 60);

		return streamSSE(c, async (stream) => {
			try {
				for await (const ev of runTurn({
					provider: pm.provider,
					model: pm.model,
					messages: conv.messages,
					wc,
				})) {
					await stream.writeSSE({ event: ev.type, data: JSON.stringify(ev) });
				}
			} catch (e) {
				await stream.writeSSE({
					event: "error",
					data: JSON.stringify({
						message: e instanceof Error ? e.message : String(e),
					}),
				});
			} finally {
				// runTurn mutates conv.messages in place; persist the full transcript.
				await saveConversation(conv.id, conv.messages, title);
			}
		});
	});

	return r;
}
