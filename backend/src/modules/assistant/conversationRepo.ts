import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db/index";
import { assistantConversations } from "../../db/schema";
import type { LlmMessage } from "./provider/types";

/**
 * DB-backed conversation history for the AI assistant. A conversation stores
 * the full LLM transcript (`messages`) so it can be resumed; the working copy
 * is rebuilt from the live project on each turn, so it is NOT persisted here.
 * Scoped per `(ownerKey, projectId)` — `ownerKey` mirrors ownerKey.ts
 * `resolveOwnerKey` (`user:<userId>`).
 */
export interface ConversationRow {
	id: string;
	ownerKey: string;
	projectId: string;
	title: string;
	messages: LlmMessage[];
	uploadedFiles: typeof assistantConversations.$inferSelect.uploadedFiles;
	createdAt: Date;
	updatedAt: Date;
}

export interface ConversationSummary {
	id: string;
	title: string;
	updatedAt: Date;
}

/**
 * Create an empty conversation. Returns its id. The grounding system prompt is
 * NOT persisted here — it is injected fresh per turn (see loop.ts `system`) so
 * evolving grounding always applies, including to resumed conversations.
 */
export async function createConversation(
	ownerKey: string,
	projectId: string,
): Promise<string> {
	const id = crypto.randomUUID();
	const now = new Date();
	await db.insert(assistantConversations).values({
		id,
		ownerKey,
		projectId,
		title: "",
		messages: [] as unknown[],
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
		projectId: r.projectId,
		title: r.title,
		messages: (r.messages ?? []) as LlmMessage[],
		uploadedFiles: r.uploadedFiles,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
	};
}

/** Summaries for a project, newest first (no message bodies). */
export async function listConversations(
	ownerKey: string,
	projectId: string,
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
				eq(assistantConversations.projectId, projectId),
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
