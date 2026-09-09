import { createHash } from "node:crypto";
import {
	type ManifestEntry,
	MigrationInputError,
	type MigrationIssue,
	type MigrationManifest,
} from "./types";
import { type ZmenuDocument, analyzeZmenu } from "./zmenuDependencies";

export function contentHash(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

/** SHA-256 of canonical JSON: sorted object keys, ordered arrays, no normalization of strings. */
export function hashJsonValue(value: unknown): string {
	const canonical = (item: unknown): unknown => {
		if (
			item === null ||
			typeof item === "string" ||
			typeof item === "boolean" ||
			(typeof item === "number" && Number.isFinite(item))
		)
			return item;
		if (Array.isArray(item)) return item.map(canonical);
		if (
			typeof item === "object" &&
			Object.getPrototypeOf(item) === Object.prototype
		)
			return Object.fromEntries(
				Object.keys(item)
					.sort()
					.map((key) => [
						key,
						canonical((item as Record<string, unknown>)[key]),
					]),
			);
		throw new MigrationInputError("invalid_json_value");
	};
	return contentHash(JSON.stringify(canonical(value)));
}

export function buildManifest(
	attachments: Record<string, string>,
	options: {
		existingTargetIds: string[];
		targetIds?: Record<string, string>;
		agentic?: boolean;
	},
): MigrationManifest {
	const keys = Object.keys(attachments);
	if (!keys.length) throw new MigrationInputError("empty_selection");
	if (
		keys.length > 200 ||
		Object.values(attachments).reduce(
			(size, content) => size + Buffer.byteLength(content),
			0,
		) >
			8 * 1024 * 1024
	)
		throw new MigrationInputError("selection_too_large");
	const documents = new Map<string, ZmenuDocument>();
	const entries: ManifestEntry[] = Object.keys(attachments)
		.sort()
		.map((fileId) => {
			const match = /^server:([^/]+)\/(.+)$/.exec(fileId);
			if (
				!match ||
				match[1].length > 128 ||
				match[2].length > 1024 ||
				fileId.includes("\\") ||
				[...fileId].some((char) => char.charCodeAt(0) < 32) ||
				match[2]
					.split("/")
					.some((part) => !part || part === "." || part === "..") ||
				(!options.agentic && !/\.ya?ml$/i.test(match[2]))
			)
				throw new MigrationInputError("invalid_source_id");
			const [, sourceId, path] = match;
			if (Buffer.byteLength(attachments[fileId]) > 1024 * 1024)
				throw new MigrationInputError("source_too_large");
			if (options.agentic)
				return {
					fileId,
					sourceId,
					path,
					byteLength: Buffer.byteLength(attachments[fileId]),
					contentHash: contentHash(attachments[fileId]),
					kind: "shared",
					targetId: null,
					dependencyIds: [],
					issues: [],
				};
			const document = analyzeZmenu(path, attachments[fileId]);
			documents.set(fileId, document);
			return {
				fileId,
				sourceId,
				path,
				byteLength: Buffer.byteLength(attachments[fileId]),
				contentHash: contentHash(attachments[fileId]),
				kind:
					document.kind === "menu"
						? "menu"
						: document.kind === "unsupported"
							? "unsupported"
							: "shared",
				targetId:
					document.kind === "menu"
						? (options.targetIds?.[fileId] ?? document.aliases[0])
						: null,
				dependencyIds: [],
				issues: [],
			};
		});
	if (options.agentic)
		return {
			version: 1,
			hash: contentHash(JSON.stringify(entries)),
			entries,
			issues: [],
			agent: { existingTargetIds: options.existingTargetIds },
		};
	for (const entry of entries) {
		const document = documents.get(entry.fileId);
		if (!document) throw new MigrationInputError("invalid_manifest");
		const issue = (code: string, message: string, reference?: string) => {
			if (entry.issues.length >= 256)
				throw new MigrationInputError("too_many_references");
			entry.issues.push({
				code,
				fileId: entry.fileId,
				message,
				...(reference === undefined || reference.length > 256
					? {}
					: { reference }),
			});
		};
		if (document.analysisIncomplete)
			issue(
				"source_analysis_incomplete",
				"Source analysis is incomplete. The AI will read the original text; verify repaired syntax and dependencies.",
			);
		if (entry.kind === "unsupported")
			issue(
				"unsupported_source",
				"This source is not a recognized zMenu menu or shared file.",
			);
		if (document.kind === "commands")
			issue(
				"commands_manual_verification",
				"Custom command bindings are indexed but must be migrated manually in this menu-only migration.",
			);
		if (entry.targetId !== null) {
			if (!/^[a-zA-Z0-9_-]{1,128}$/.test(entry.targetId))
				issue("invalid_target_id", "Choose a valid Artisan menu identifier.");
			if (
				entries.filter((candidate) => candidate.targetId === entry.targetId)
					.length > 1
			)
				issue(
					"target_collision",
					"Several sources reserve the same target identifier.",
				);
			if (options.existingTargetIds.includes(entry.targetId))
				issue(
					"target_exists",
					"The target already exists; choose a different identifier.",
				);
		}
		for (const ref of document.references) {
			if (ref.external || ref.value.includes(":")) {
				issue(
					"external_reference",
					"A reference targets an external plugin.",
					ref.value,
				);
				continue;
			}
			if (/[%{}]/.test(ref.value)) {
				issue(
					"dynamic_reference",
					"A dynamic reference requires manual verification.",
					ref.value,
				);
				continue;
			}
			const matches = entries.filter(
				(candidate) =>
					documents.get(candidate.fileId)?.kind === ref.kind &&
					documents.get(candidate.fileId)?.aliases.includes(ref.value),
			);
			if (matches.length === 1) entry.dependencyIds.push(matches[0].fileId);
			else
				issue(
					matches.length > 1 ? "ambiguous_reference" : "missing_reference",
					matches.length > 1
						? "Several selected sources match this reference."
						: "A referenced source is not in the selection.",
					ref.value,
				);
		}
		entry.dependencyIds = [...new Set(entry.dependencyIds)].sort();
	}
	return {
		version: 1,
		hash: contentHash(JSON.stringify(entries)),
		entries,
		issues: entries.flatMap((entry) => entry.issues),
	};
}

export function verifyManifestSources(
	manifest: MigrationManifest,
	attachments: Record<string, string>,
): MigrationIssue[] {
	return manifest.entries.flatMap((entry) =>
		!Object.hasOwn(attachments, entry.fileId)
			? [
					{
						code: "source_missing",
						fileId: entry.fileId,
						message: "A selected source is unavailable.",
					},
				]
			: contentHash(attachments[entry.fileId]) !== entry.contentHash
				? [
						{
							code: "source_changed",
							fileId: entry.fileId,
							message:
								"A selected source changed; analyze the selection again.",
						},
					]
				: [],
	);
}
