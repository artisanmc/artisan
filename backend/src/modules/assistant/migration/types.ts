export interface MigrationIssue {
	code: string;
	fileId?: string;
	targetId?: string;
	reference?: string;
	message: string;
}

export interface ManifestEntry {
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

export interface MigrationManifest {
	version: 1;
	agent?: {
		existingTargetIds: string[];
		tasks?: MigrationTask[];
		reports?: { fileId: string; role: string; notes: string }[];
	};
	hash: string;
	entries: ManifestEntry[];
	issues: MigrationIssue[];
}

export interface MigrationTask {
	sourceFileId: string;
	targetId: string;
	instructions: string;
	dependencyIds: string[];
}

export type MigrationStatus =
	| "analyzing"
	| "ready"
	| "running"
	| "paused"
	| "blocked"
	| "completed"
	| "cancelled";
export type MigrationStepStatus =
	| "pending"
	| "running"
	| "completed"
	| "interrupted"
	| "blocked";
export interface MigrationBudget {
	/** Legacy stored cap; no longer enforced. New migrations store null. */
	maxCredits: number | null;
	usedCredits: number;
	contextTokens: number;
	maxOutputTokens: number;
}
export interface MigrationTranslationChange {
	locale: string;
	key: string;
	value: string;
	baseHash: string | null;
	resultHash: string;
}
/** Null baseHash means the target was absent, never an empty string/value. */
export interface MigrationProposal {
	id: string;
	stepId: string;
	targetId: string;
	baseHash: string | null;
	resultHash: string;
	menu: Record<string, unknown>;
	translations?: MigrationTranslationChange[];
	issues: MigrationIssue[];
}
export interface MigrationStep {
	id: string;
	key: string;
	sourceFileId: string;
	targetId: string;
	status: MigrationStepStatus;
	attemptCount: number;
	proposalId: string | null;
	credits: number;
}
export interface MigrationRun {
	id: string;
	conversationId: string;
	projectId: string;
	modelId: string;
	status: MigrationStatus;
	revision: number;
	manifest: MigrationManifest;
	budget: MigrationBudget;
	steps: MigrationStep[];
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

export class MigrationInputError extends Error {
	constructor(public readonly code: string) {
		super(code);
		this.name = "MigrationInputError";
	}
}

/** Unknown issues fail closed. Warnings must remain visible through final verification. */
export function isBlockingMigrationIssue(issue: MigrationIssue): boolean {
	return ![
		"source_analysis_incomplete",
		"missing_reference",
		"dynamic_reference",
		"external_reference",
		"ambiguous_reference",
		"commands_manual_verification",
	].includes(issue.code);
}
