import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/index";
import { assistantConversations } from "../../db/schema";
import { buildSystemPrompt } from "./grounding";
import type { LlmMessage } from "./provider/types";

/**
 * DB-backed conversation history for the AI assistant. A conversation stores
 * the full LLM transcript (`messages`) so it can be resumed; the working copy
 * is rebuilt from the live pack on each turn, so it is NOT persisted here.
 * Scoped per `(ownerKey, packId)` — `ownerKey` mirrors routes.ts
 * `resolveOwnerKey` (`sk:<serverKeyId>` or `user:<userId>`).
 */
export interface ConversationRow {
	id: string;
	ownerKey: string;
	packId: string;
	title: string;
	messages: LlmMessage[];
	createdAt: Date;
	updatedAt: Date;
}

export interface ConversationSummary {
	id: string;
	title: string;
	updatedAt: Date;
}

/** Create a conversation seeded with the system prompt. Returns its id. */
export async function createConversation(
	ownerKey: string,
	packId: string,
): Promise<string> {
	const id = crypto.randomUUID();
	const now = new Date();
	await db.insert(assistantConversations).values({
		id,
		ownerKey,
		packId,
		title: "",
		messages: [{ role: "system", content: buildSystemPrompt() }] as unknown[],
		createdAt: now,
		updatedAt: now,
	});
	return id;
}

export async function getConversation(
	id: string,
): Promise<ConversationRow | null> {
	const rows = await db
		.select()
		.from(assistantConversations)
		.where(eq(assistantConversations.id, id));
	if (rows.length === 0) return null;
	const r = rows[0];
	return {
		id: r.id,
		ownerKey: r.ownerKey,
		packId: r.packId,
		title: r.title,
		messages: (r.messages ?? []) as LlmMessage[],
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	};
}

/** Summaries for a workspace, newest first (no message bodies). */
export async function listConversations(
	ownerKey: string,
	packId: string,
): Promise<ConversationSummary[]> {
	return db
		.select({
			id: assistantConversations.id,
			title: assistantConversations.title,
			updatedAt: assistantConversations.updatedAt,
		})
		.from(assistantConversations)
		.where(
			and(
				eq(assistantConversations.ownerKey, ownerKey),
				eq(assistantConversations.packId, packId),
			),
		)
		.orderBy(desc(assistantConversations.updatedAt));
}

/** Persist the full transcript + title after a turn (bumps updatedAt). */
export async function saveConversation(
	id: string,
	messages: LlmMessage[],
	title: string,
): Promise<void> {
	await db
		.update(assistantConversations)
		.set({ messages: messages as unknown[], title, updatedAt: new Date() })
		.where(eq(assistantConversations.id, id));
}
