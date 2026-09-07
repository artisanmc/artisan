export interface MigrationIssue {
	code: string;
	fileId?: string;
	targetId?: string;
	reference?: string;
	message: string;
}
export interface MigrationEntry {
	fileId: string;
	sourceId: string;
	path: string;
	byteLength: number;
	contentHash: string;
	kind: "menu" | "shared" | "unsupported";
	targetId: string | null;
	dependencyIds: string[];
	issues: MigrationIssue[];
}
export interface MigrationProposal {
	id: string;
	stepId: string;
	targetId: string;
	baseHash: string | null;
	resultHash: string;
	menu: Record<string, unknown>;
	translations?: {
		locale: string;
		key: string;
		value: string;
		baseHash: string | null;
		resultHash: string;
	}[];
	issues: MigrationIssue[];
}
export interface MigrationRun {
	id: string;
	conversationId: string;
	projectId: string;
	modelId: string;
	status:
		| "analyzing"
		| "ready"
		| "running"
		| "paused"
		| "blocked"
		| "completed"
		| "cancelled";
	revision: number;
	manifest: {
		version: 1;
		hash: string;
		entries: MigrationEntry[];
		issues: MigrationIssue[];
	};
	budget: {
		maxCredits: number;
		usedCredits: number;
		contextTokens: number;
		maxOutputTokens: number;
	};
	steps: {
		id: string;
		key: string;
		sourceFileId: string;
		targetId: string;
		status: "pending" | "running" | "completed" | "interrupted" | "blocked";
		attemptCount: number;
		proposalId: string | null;
		credits: number;
	}[];
	issues: MigrationIssue[];
	createdAt: string;
	updatedAt: string;
}
export interface MigrationEvent {
	sequence: number;
	runId: string;
	type: string;
	stepId?: string;
	code?: string;
	createdAt: string;
}
export interface CreateMigrationInput {
	requestId: string;
	modelId: string;
	maxCredits: number;
	serverAttachments: { sourceId: string; paths: string[] }[];
	existingTargetIds: string[];
	targetIds?: Record<string, string>;
}
export type MigrationAction = "start" | "resume" | "pause" | "cancel";
export class MigrationRequestError extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
	) {
		super(code);
		this.name = "MigrationRequestError";
	}
}
async function request<T>(
	conversationId: string,
	path = "",
	body?: unknown,
	signal?: AbortSignal,
): Promise<T> {
	const base =
		(import.meta.env.VITE_API_URL as string | undefined) ??
		"http://localhost:3001";
	const response = await fetch(
		`${base}/api/v1/assistant/conversations/${encodeURIComponent(conversationId)}/migrations${path}`,
		{
			credentials: "include",
			signal,
			...(body === undefined
				? {}
				: {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(body),
					}),
		},
	);
	if (!response.ok) {
		const payload = await response.json().catch(() => ({}));
		throw new MigrationRequestError(
			typeof payload.error === "string" ? payload.error : "migration_error",
			response.status,
		);
	}
	return response.json() as Promise<T>;
}
export async function listMigrations(
	id: string,
	signal?: AbortSignal,
): Promise<MigrationRun[]> {
	return (await request<{ runs: MigrationRun[] }>(id, "", undefined, signal))
		.runs;
}
export async function getMigration(
	id: string,
	runId: string,
	signal?: AbortSignal,
): Promise<MigrationRun> {
	return (
		await request<{ run: MigrationRun }>(
			id,
			`/${encodeURIComponent(runId)}`,
			undefined,
			signal,
		)
	).run;
}
export async function getMigrationProposals(
	id: string,
	runId: string,
	signal?: AbortSignal,
): Promise<MigrationProposal[]> {
	return (
		await request<{ proposals: MigrationProposal[] }>(
			id,
			`/${encodeURIComponent(runId)}/proposals`,
			undefined,
			signal,
		)
	).proposals;
}
export async function getMigrationEvents(
	id: string,
	runId: string,
	signal?: AbortSignal,
	after = 0,
): Promise<MigrationEvent[]> {
	return (
		await request<{ events: MigrationEvent[] }>(
			id,
			`/${encodeURIComponent(runId)}/events?limit=200&after=${after}`,
			undefined,
			signal,
		)
	).events;
}
export async function createMigration(
	id: string,
	input: CreateMigrationInput,
): Promise<MigrationRun> {
	return (await request<{ run: MigrationRun }>(id, "", input)).run;
}
export async function controlMigration(
	id: string,
	runId: string,
	action: MigrationAction,
	expectedRevision: number,
): Promise<MigrationRun> {
	return (
		await request<{ run: MigrationRun }>(
			id,
			`/${encodeURIComponent(runId)}/${action}`,
			{ expectedRevision },
		)
	).run;
}
