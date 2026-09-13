import { requestImportSourcesRead } from "../../ws/hub";
import type { LlmMessage } from "./provider/types";

export const SERVER_ATTACHMENT_REDACTION =
	"[Contenu de la pièce jointe serveur non conservé après ce tour.]";
export const SERVER_ATTACHMENT_PROVIDER_ERROR =
	"server_attachment_provider_error";
export const MAX_SERVER_ATTACHMENT_FILES = 200;
export const MAX_SERVER_ATTACHMENT_GROUPS = 32;
export const MAX_SERVER_ATTACHMENT_SOURCE_ID_LENGTH = 128;
export const MAX_SERVER_ATTACHMENT_PATH_LENGTH = 1024;

export interface ServerAttachmentSelection {
	sourceId: string;
	paths: string[];
}

export type ImportSourcesReadFn = typeof requestImportSourcesRead;

export type ResolvedServerAttachments =
	| { ok: true; attachments: Record<string, string> }
	| {
			ok: false;
			error: string;
			status: 404 | 422 | 502 | 503 | 504;
	  };

export function redactServerAttachmentToolResults(
	messages: LlmMessage[],
	serverAttachmentIds: ReadonlySet<string>,
	replacement = SERVER_ATTACHMENT_REDACTION,
): LlmMessage[] {
	if (serverAttachmentIds.size === 0) return messages;

	const serverReadCallIds = new Set<string>();
	for (const message of messages) {
		if (message.role !== "assistant") continue;
		for (const toolCall of message.toolCalls ?? []) {
			if (toolCall.name !== "read_attachment") continue;
			try {
				const input = JSON.parse(toolCall.arguments) as Record<string, unknown>;
				if (
					typeof input.file_id === "string" &&
					serverAttachmentIds.has(input.file_id)
				) {
					serverReadCallIds.add(toolCall.id);
				}
			} catch {
				// Malformed tool arguments cannot identify a server attachment.
			}
		}
	}

	return messages.map((message) =>
		message.role === "tool" && serverReadCallIds.has(message.toolCallId)
			? { ...message, content: replacement }
			: message,
	);
}

const UNPROCESSABLE_ERRORS = new Set([
	"invalid_input",
	"invalid_path",
	"unsupported_file",
	"too_many_files",
	"file_too_large",
	"too_large",
	"invalid_utf8",
]);
const NOT_FOUND_ERRORS = new Set(["unknown_source", "not_found"]);

function isSelection(value: unknown): value is ServerAttachmentSelection {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const selection = value as Record<string, unknown>;
	return (
		typeof selection.sourceId === "string" &&
		selection.sourceId.length <= MAX_SERVER_ATTACHMENT_SOURCE_ID_LENGTH &&
		selection.sourceId.trim().length > 0 &&
		Array.isArray(selection.paths) &&
		selection.paths.length > 0 &&
		selection.paths.length <= MAX_SERVER_ATTACHMENT_FILES &&
		selection.paths.every(
			(path) =>
				typeof path === "string" &&
				path.length <= MAX_SERVER_ATTACHMENT_PATH_LENGTH &&
				path.trim().length > 0,
		)
	);
}

export async function resolveServerAttachments(
	serverKeyId: string | null,
	raw: unknown,
	read: ImportSourcesReadFn = requestImportSourcesRead,
): Promise<ResolvedServerAttachments> {
	if (raw === undefined || (Array.isArray(raw) && raw.length === 0)) {
		return { ok: true, attachments: {} };
	}
	if (!serverKeyId) return { ok: false, error: "server_unavailable", status: 422 };
	if (
		!Array.isArray(raw) ||
		raw.length > MAX_SERVER_ATTACHMENT_GROUPS ||
		!raw.every(isSelection)
	) {
		return { ok: false, error: "invalid_input", status: 422 };
	}
	const selections = raw;
	const requestedCount = selections.reduce(
		(count, selection) => count + selection.paths.length,
		0,
	);
	if (requestedCount > MAX_SERVER_ATTACHMENT_FILES) {
		return { ok: false, error: "invalid_input", status: 422 };
	}
	const requestedIds = new Set(
		selections.flatMap((selection) =>
			selection.paths.map((path) => `server:${selection.sourceId}/${path}`),
		),
	);
	if (requestedIds.size !== requestedCount) {
		return { ok: false, error: "invalid_input", status: 422 };
	}
	const outcome = await read(
		serverKeyId,
		selections.map((selection) => ({
			source_id: selection.sourceId,
			paths: selection.paths,
		})),
	);
	if (outcome.kind === "offline") {
		return { ok: false, error: "server_offline", status: 503 };
	}
	if (outcome.kind === "timeout") {
		return { ok: false, error: "fetch_timeout", status: 504 };
	}
	if (typeof outcome.result.ok !== "boolean") {
		return { ok: false, error: "read_error", status: 502 };
	}
	if (!outcome.result.ok) {
		const error =
			typeof outcome.result.error === "string" &&
			outcome.result.error.trim().length > 0
				? outcome.result.error
				: "read_error";
		if (!NOT_FOUND_ERRORS.has(error) && !UNPROCESSABLE_ERRORS.has(error)) {
			return { ok: false, error: "read_error", status: 502 };
		}
		return {
			ok: false,
			error,
			status: NOT_FOUND_ERRORS.has(error) ? 404 : 422,
		};
	}
	if (
		!Array.isArray(outcome.result.files) ||
		!outcome.result.files.every(
			(file) =>
				file !== null &&
				typeof file === "object" &&
				typeof file.source_id === "string" &&
				file.source_id.trim().length > 0 &&
				typeof file.path === "string" &&
				file.path.trim().length > 0 &&
				typeof file.content === "string",
		)
	) {
		return { ok: false, error: "read_error", status: 502 };
	}
	if (outcome.result.files.length !== requestedIds.size) {
		return { ok: false, error: "read_error", status: 502 };
	}
	const attachments: Record<string, string> = {};
	for (const file of outcome.result.files) {
		const id = `server:${file.source_id}/${file.path}`;
		if (!requestedIds.has(id) || Object.hasOwn(attachments, id)) {
			return { ok: false, error: "read_error", status: 502 };
		}
		attachments[id] = file.content;
	}
	return { ok: true, attachments };
}
