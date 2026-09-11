import { eq } from "drizzle-orm";
import { db } from "../../db";
import { assistantConversations } from "../../db/schema";

type Scope = { networkId: string; serverKeyId: string };
type StoredUploads = typeof assistantConversations.$inferSelect.uploadedFiles;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export class UploadError extends Error {}

export function mergeUploads(
	stored: StoredUploads,
	scope: Scope,
	incoming: unknown,
): Record<string, string> {
	if (
		incoming !== undefined &&
		(!incoming || typeof incoming !== "object" || Array.isArray(incoming))
	)
		throw new UploadError("invalid_attachments");
	const files = Object.fromEntries(
		Object.entries(
			stored?.networkId === scope.networkId &&
				stored.serverKeyId === scope.serverKeyId
				? stored.files
				: {},
		),
	);
	for (const [name, content] of Object.entries(incoming ?? {})) {
		if (
			!name.trim() ||
			name.length > 1024 ||
			name.startsWith("server:") ||
			typeof content !== "string"
		)
			throw new UploadError("invalid_attachments");
		if (Buffer.byteLength(content, "utf8") > 1024 * 1024)
			throw new UploadError("attachment_too_large");
		Object.defineProperty(files, name, {
			value: content,
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	if (
		Object.keys(files).length > 200 ||
		Buffer.byteLength(JSON.stringify(files), "utf8") > 8 * 1024 * 1024
	)
		throw new UploadError("attachments_too_large");
	return files;
}

// Called inside the same transaction as task acceptance, before any provider call.
export async function storeUploads(
	tx: Transaction,
	conversationId: string,
	scope: Scope,
	incoming: unknown,
) {
	const [conversation] = await tx
		.select()
		.from(assistantConversations)
		.where(eq(assistantConversations.id, conversationId))
		.for("update");
	if (!conversation) throw new UploadError("conversation_not_found");
	const files = mergeUploads(conversation.uploadedFiles, scope, incoming);
	await tx
		.update(assistantConversations)
		.set({ uploadedFiles: { ...scope, files } })
		.where(eq(assistantConversations.id, conversationId));
}
