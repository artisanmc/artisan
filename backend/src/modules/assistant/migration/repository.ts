import { and, desc, eq, gt, ne } from "drizzle-orm";
import { db } from "../../../db";
import {
	assistantMigrationEvents as events,
	assistantMigrationProposals as proposals,
	assistantMigrationRuns as runs,
	assistantMigrationSteps as steps,
} from "../../../db/schema";
import {
	type UsageInput,
	recordDebitedTurnInTransaction,
	recordErrorTurnInTransaction,
} from "../../ai/usageRepo";
import { hashJsonValue } from "./manifest";
import {
	type ManifestEntry,
	type MigrationBudget,
	MigrationInputError,
	type MigrationManifest,
	type MigrationProposal,
	type MigrationRun,
	type MigrationStatus,
	type MigrationStepStatus,
	isBlockingMigrationIssue,
} from "./types";

type RunRow = typeof runs.$inferSelect;
type StepRow = typeof steps.$inferSelect;
export const MIGRATION_LEASE_MS = 90_000;
async function lockRun(tx: typeof db, id: string): Promise<RunRow> {
	const [row] = await tx
		.select()
		.from(runs)
		.where(eq(runs.id, id))
		.for("update");
	if (!row) throw new MigrationInputError("run_not_found");
	return row;
}
async function event(
	tx: typeof db,
	row: RunRow,
	type: string,
	now: Date,
	stepId?: string,
	code?: string,
) {
	row.revision++;
	await tx
		.update(runs)
		.set({ revision: row.revision, updatedAt: now })
		.where(eq(runs.id, row.id));
	await tx.insert(events).values({
		runId: row.id,
		sequence: row.revision,
		type,
		stepId,
		code,
		createdAt: now,
	});
}

export interface CreateRunInput {
	conversationId: string;
	projectId: string;
	ownerKey: string;
	networkId: string;
	serverKeyId: string;
	modelId: string;
	requestId: string;
	requestHash: string;
	manifest: MigrationManifest;
	budget: MigrationBudget;
}
export async function createRun(input: CreateRunInput): Promise<MigrationRun> {
	if (
		input.manifest.entries.length > 200 ||
		Buffer.byteLength(JSON.stringify(input.manifest)) > 1024 * 1024
	)
		throw new MigrationInputError("manifest_too_large");
	if (
		![input.budget.contextTokens, input.budget.maxOutputTokens].every(
			(n) => Number.isSafeInteger(n) && n > 0 && n <= 2_000_000_000,
		) ||
		input.budget.usedCredits !== 0 ||
		input.budget.maxOutputTokens >= input.budget.contextTokens
	)
		throw new MigrationInputError("invalid_budget");
	const id = crypto.randomUUID();
	const now = new Date();
	const entries =
		input.manifest.agent && !input.manifest.agent.tasks
			? [{ fileId: "", targetId: "" }]
			: input.manifest.entries.filter(
					(e): e is ManifestEntry & { targetId: string } =>
						e.kind === "menu" && typeof e.targetId === "string",
				);
	const issues = entries.length
		? input.manifest.issues
		: [
				...input.manifest.issues,
				{
					code: "no_menus_to_migrate",
					message: "The selection contains no menus to migrate.",
				},
			];
	const runId = await db.transaction(async (tx) => {
		const inserted = await tx
			.insert(runs)
			.values({
				...input,
				id,
				issues,
				status: issues.some(isBlockingMigrationIssue) ? "blocked" : "ready",
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoNothing()
			.returning({ id: runs.id });
		if (!inserted.length) {
			const [existing] = await tx
				.select()
				.from(runs)
				.where(
					and(
						eq(runs.conversationId, input.conversationId),
						eq(runs.requestId, input.requestId),
					),
				);
			if (existing.requestHash !== input.requestHash)
				throw new MigrationInputError("request_conflict");
			return existing.id;
		}
		if (entries.length)
			await tx.insert(steps).values(
				entries.map((entry, position) => ({
					id: crypto.randomUUID(),
					runId: id,
					position,
					key: hashJsonValue([
						input.manifest.hash,
						entry.fileId,
						entry.targetId,
					]),
					sourceFileId: entry.fileId,
					targetId: entry.targetId,
					status: "pending",
				})),
			);
		return id;
	});
	return requireRun(runId);
}
async function requireRun(id: string): Promise<MigrationRun> {
	const run = await getRun(id);
	if (!run) throw new MigrationInputError("run_not_found");
	return run;
}
export async function getRun(id: string): Promise<MigrationRun | null> {
	const [row] = await db.select().from(runs).where(eq(runs.id, id));
	if (!row) return null;
	const stepRows = await db
		.select()
		.from(steps)
		.where(eq(steps.runId, id))
		.orderBy(steps.position);
	const proposalRows = await db
		.select()
		.from(proposals)
		.where(eq(proposals.runId, id));
	return {
		id,
		conversationId: row.conversationId,
		projectId: row.projectId,
		modelId: row.modelId,
		status: row.status as MigrationStatus,
		revision: row.revision,
		manifest: row.manifest as MigrationManifest,
		budget: row.budget as MigrationBudget,
		issues: row.issues as MigrationRun["issues"],
		steps: stepRows.map((s) => ({
			id: s.id,
			key: s.key,
			sourceFileId: s.sourceFileId,
			targetId: s.targetId,
			status: s.status as MigrationStepStatus,
			attemptCount: s.attemptCount,
			credits: s.credits,
			proposalId: proposalRows.find((p) => p.stepId === s.id)?.id ?? null,
		})),
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}
export async function listRuns(
	conversationId: string,
): Promise<MigrationRun[]> {
	const rows = await db
		.select({ id: runs.id })
		.from(runs)
		.where(eq(runs.conversationId, conversationId))
		.orderBy(desc(runs.createdAt))
		.limit(20);
	return (await Promise.all(rows.map((r) => getRun(r.id)))).filter(
		(r): r is MigrationRun => r !== null,
	);
}

export async function getRunContext(id: string) {
	const [row] = await db.select().from(runs).where(eq(runs.id, id));
	const run = await getRun(id);
	return row && run
		? {
				run,
				ownerKey: row.ownerKey,
				networkId: row.networkId,
				serverKeyId: row.serverKeyId,
			}
		: null;
}
export async function getRunByRequest(
	conversationId: string,
	requestId: string,
): Promise<{ run: MigrationRun; requestHash: string } | null> {
	const [row] = await db
		.select()
		.from(runs)
		.where(
			and(
				eq(runs.conversationId, conversationId),
				eq(runs.requestId, requestId),
			),
		);
	return row
		? { run: await requireRun(row.id), requestHash: row.requestHash }
		: null;
}
export async function getProposals(
	runId: string,
): Promise<MigrationProposal[]> {
	const rows = await db
		.select()
		.from(proposals)
		.where(eq(proposals.runId, runId));
	return rows.map((r) => r.proposal as MigrationProposal);
}
export async function getEvents(runId: string, after = 0, limit = 100) {
	const rows = await db
		.select()
		.from(events)
		.where(and(eq(events.runId, runId), gt(events.sequence, after)))
		.orderBy(events.sequence)
		.limit(Math.min(200, Math.max(1, limit)));
	return rows.map((r) => ({
		...r,
		stepId: r.stepId ?? undefined,
		code: r.code ?? undefined,
		createdAt: r.createdAt.toISOString(),
	}));
}
export type MigrationAction = "start" | "resume" | "pause" | "cancel";
export async function transitionRun(
	id: string,
	expectedRevision: number,
	action: MigrationAction,
	now = new Date(),
): Promise<MigrationRun> {
	await db.transaction(async (tx) => {
		const row = await lockRun(tx, id);
		if (row.revision !== expectedRevision)
			throw new MigrationInputError("revision_conflict");
		if (row.revision >= 10_000 && action !== "cancel")
			throw new MigrationInputError("migration_event_limit");
		const transitions: Record<MigrationAction, string[]> = {
			start: ["ready"],
			resume: ["paused"],
			pause: ["running"],
			cancel: ["ready", "running", "paused", "blocked"],
		};
		if (!transitions[action].includes(row.status))
			throw new MigrationInputError("invalid_transition");
		await tx
			.update(runs)
			.set({
				status:
					action === "pause"
						? "paused"
						: action === "cancel"
							? "cancelled"
							: "running",
			})
			.where(eq(runs.id, id));
		await event(tx, row, action, now);
	});
	return requireRun(id);
}
export interface ClaimedMigrationStep {
	run: MigrationRun;
	step: MigrationRun["steps"][number];
	leaseToken: string;
	leaseExpiresAt: Date;
	ownerKey: string;
	networkId: string;
	serverKeyId: string;
}
export async function claimNextStep(
	id: string,
	leaseOwner: string,
	now = new Date(),
): Promise<ClaimedMigrationStep | null> {
	const claim = await db.transaction(async (tx) => {
		const row = await lockRun(tx, id);
		if (row.status !== "running") return null;
		const all = await tx
			.select()
			.from(steps)
			.where(eq(steps.runId, id))
			.orderBy(steps.position);
		if (all.some((s) => s.status === "running")) return null;
		const step = all.find(
			(s) => s.status === "pending" || s.status === "interrupted",
		);
		if (!step) return null;
		if (step.attemptCount >= 10 || row.revision >= 10_000) {
			await tx
				.update(runs)
				.set({
					status: "blocked",
					issues: [
						...(row.issues as MigrationRun["issues"]).slice(0, 999),
						{
							code: "migration_attempt_limit",
							message: "Migration retry limit reached.",
						},
					],
				})
				.where(eq(runs.id, id));
			await event(tx, row, "blocked", now, step.id, "migration_attempt_limit");
			return null;
		}
		const leaseToken = crypto.randomUUID();
		const leaseExpiresAt = new Date(now.getTime() + MIGRATION_LEASE_MS);
		await tx
			.update(steps)
			.set({
				status: "running",
				leaseOwner,
				leaseToken,
				leaseExpiresAt,
				attemptCount: step.attemptCount + 1,
			})
			.where(eq(steps.id, step.id));
		await event(tx, row, "step_started", now, step.id);
		return {
			stepId: step.id,
			leaseToken,
			leaseExpiresAt,
			ownerKey: row.ownerKey,
			networkId: row.networkId,
			serverKeyId: row.serverKeyId,
		};
	});
	if (!claim) return null;
	const run = await requireRun(id);
	const step = run.steps.find((s) => s.id === claim.stepId);
	if (!step) throw new MigrationInputError("step_not_found");
	return { ...claim, run, step };
}
function checkLease(
	step: StepRow | undefined,
	token: string,
	now: Date,
): asserts step is StepRow {
	if (
		!step ||
		step.status !== "running" ||
		step.leaseToken !== token ||
		!step.leaseExpiresAt ||
		step.leaseExpiresAt <= now
	)
		throw new MigrationInputError("lease_lost");
}
export interface CompleteStepInput {
	runId: string;
	stepId: string;
	leaseToken: string;
	proposal: Omit<MigrationProposal, "id" | "stepId">;
	usageInput: UsageInput;
}

/** The discovery checkpoint and its debit are atomic, just like a generated menu. */
export async function completeDiscovery(
	input: Omit<CompleteStepInput, "proposal"> & { manifest: MigrationManifest },
	now = new Date(),
): Promise<void> {
	await db.transaction(async (tx) => {
		const row = await lockRun(tx, input.runId);
		const [step] = await tx
			.select()
			.from(steps)
			.where(and(eq(steps.id, input.stepId), eq(steps.runId, row.id)));
		if (step?.status === "completed" && step.leaseToken === input.leaseToken)
			return;
		checkLease(step, input.leaseToken, now);
		const original = row.manifest as MigrationManifest;
		const tasks = input.manifest.agent?.tasks;
		if (
			step.sourceFileId !== "" ||
			!original.agent ||
			original.agent.tasks ||
			!tasks ||
			input.manifest.hash !== original.hash ||
			hashJsonValue(input.manifest.entries) !==
				hashJsonValue(original.entries) ||
			tasks.length > 200 ||
			Buffer.byteLength(JSON.stringify(input.manifest)) > 1024 * 1024
		)
			throw new MigrationInputError("invalid_plan");
		if (
			input.usageInput.networkId !== row.networkId ||
			input.usageInput.model.id !== row.modelId
		)
			throw new MigrationInputError("usage_scope_mismatch");
		if (tasks.length)
			await tx.insert(steps).values(
				tasks.map((task, index) => ({
					id: crypto.randomUUID(),
					runId: row.id,
					position: index + 1,
					key: hashJsonValue([original.hash, task.sourceFileId, task.targetId]),
					sourceFileId: task.sourceFileId,
					targetId: task.targetId,
					status: "pending",
				})),
			);
		const { debited } = await recordDebitedTurnInTransaction(
			tx,
			{
				...input.usageInput,
				conversationId: row.conversationId,
				serverKeyId: row.serverKeyId,
				actionType: "migration",
				promptPreview: "Menu migration exploration",
			},
			{ idempotencyKey: `migration:${step.id}` },
		);
		await tx
			.update(steps)
			.set({
				status: "completed",
				credits: debited,
				leaseExpiresAt: null,
				leaseOwner: null,
			})
			.where(eq(steps.id, step.id));
		const issues = tasks.length
			? original.issues
			: [
					...original.issues,
					{
						code: "no_menus_to_migrate",
						message: "No menu was identified; review the exploration report.",
					},
				];
		await tx
			.update(runs)
			.set({
				manifest: input.manifest,
				issues,
				budget: {
					...(row.budget as MigrationBudget),
					usedCredits: (row.budget as MigrationBudget).usedCredits + debited,
				},
				status:
					row.status === "cancelled"
						? "cancelled"
						: !tasks.length
							? "blocked"
							: row.status,
			})
			.where(eq(runs.id, row.id));
		await event(tx, row, "exploration_completed", now, step.id);
	});
}
export async function completeStep(
	input: CompleteStepInput,
	now = new Date(),
): Promise<MigrationProposal> {
	return db.transaction(async (tx) => {
		const row = await lockRun(tx, input.runId);
		const [step] = await tx
			.select()
			.from(steps)
			.where(and(eq(steps.id, input.stepId), eq(steps.runId, row.id)));
		if (step?.status === "completed") {
			if (step.leaseToken !== input.leaseToken)
				throw new MigrationInputError("lease_lost");
			const [existing] = await tx
				.select()
				.from(proposals)
				.where(eq(proposals.stepId, step.id));
			return existing.proposal as MigrationProposal;
		}
		checkLease(step, input.leaseToken, now);
		if (
			input.proposal.targetId !== step.targetId ||
			input.proposal.menu.id !== step.targetId ||
			input.proposal.baseHash !== step.baseHash ||
			input.proposal.resultHash !== hashJsonValue(input.proposal.menu)
		)
			throw new MigrationInputError("invalid_proposal");
		if (Buffer.byteLength(JSON.stringify(input.proposal)) > 1024 * 1024)
			throw new MigrationInputError("proposal_too_large");
		if (
			input.usageInput.networkId !== row.networkId ||
			input.usageInput.model.id !== row.modelId
		)
			throw new MigrationInputError("usage_scope_mismatch");
		const proposal = {
			...input.proposal,
			id: crypto.randomUUID(),
			stepId: step.id,
		};
		await tx
			.insert(proposals)
			.values({ id: proposal.id, runId: row.id, stepId: step.id, proposal });
		const { debited } = await recordDebitedTurnInTransaction(
			tx,
			{
				...input.usageInput,
				conversationId: row.conversationId,
				serverKeyId: row.serverKeyId,
				actionType: "migration",
				promptPreview: "zMenu migration",
			},
			{ idempotencyKey: `migration:${step.id}` },
		);
		await tx
			.update(steps)
			.set({
				status: "completed",
				credits: debited,
				leaseExpiresAt: null,
				leaseOwner: null,
			})
			.where(eq(steps.id, step.id));
		const remaining = await tx
			.select({ id: steps.id })
			.from(steps)
			.where(and(eq(steps.runId, row.id), ne(steps.status, "completed")));
		const budget = {
			...(row.budget as MigrationBudget),
			usedCredits: (row.budget as MigrationBudget).usedCredits + debited,
		};
		const status =
			row.status === "cancelled"
				? "cancelled"
				: !remaining.length
					? "completed"
					: row.status !== "running"
						? row.status
						: "running";
		await tx.update(runs).set({ budget, status }).where(eq(runs.id, row.id));
		await event(tx, row, "step_completed", now, step.id);
		return proposal;
	});
}

export async function renewLease(
	runId: string,
	stepId: string,
	leaseToken: string,
	now = new Date(),
): Promise<boolean> {
	return db.transaction(async (tx) => {
		await lockRun(tx, runId);
		const [step] = await tx
			.select()
			.from(steps)
			.where(and(eq(steps.id, stepId), eq(steps.runId, runId)));
		try {
			checkLease(step, leaseToken, now);
		} catch {
			return false;
		}
		await tx
			.update(steps)
			.set({ leaseExpiresAt: new Date(now.getTime() + MIGRATION_LEASE_MS) })
			.where(eq(steps.id, stepId));
		return true;
	});
}

export interface InterruptStepInput {
	runId: string;
	stepId: string;
	leaseToken: string;
	code: string;
	usageInput?: UsageInput;
}
const FAILURE_CODES = new Set([
	"tool_batch_limit",
	"invalid_plan",
	"insufficient_credits",
	"provider_timeout",
	"provider_network_error",
	"provider_cancelled",
	"provider_error",
	"engine_error",
	"lease_expired",
	"source_changed",
	"source_missing",
	"server_offline",
	"fetch_timeout",
	"read_error",
	"forbidden",
	"project_not_found",
	"scope_changed",
	"model_unavailable",
	"migration_budget_exceeded",
	"step_budget_exceeded",
	"context_budget_exceeded",
	"invalid_proposal",
	"invalid_menu",
	"target_mismatch",
	"migration_error",
	"migration_attempt_limit",
	"provider_output_limit",
	"invalid_tool",
	"missing_proposal",
	"unknown_menu_reference",
	"missing_generated_reference",
	"invalid_step_source",
	"invalid_manifest_dependency",
]);
function safeCode(code: string): string {
	return FAILURE_CODES.has(code) ? code : "migration_error";
}
export async function interruptStep(
	input: InterruptStepInput,
	now = new Date(),
): Promise<void> {
	await db.transaction(async (tx) => {
		const row = await lockRun(tx, input.runId);
		const [step] = await tx
			.select()
			.from(steps)
			.where(and(eq(steps.id, input.stepId), eq(steps.runId, row.id)));
		if (step?.status === "interrupted" && step.leaseToken === input.leaseToken)
			return;
		checkLease(step, input.leaseToken, now);
		const code = safeCode(input.code);
		if (input.usageInput) {
			if (
				input.usageInput.networkId !== row.networkId ||
				input.usageInput.model.id !== row.modelId
			)
				throw new MigrationInputError("usage_scope_mismatch");
			await recordErrorTurnInTransaction(
				tx,
				{
					...input.usageInput,
					conversationId: row.conversationId,
					serverKeyId: row.serverKeyId,
					actionType: "migration",
					promptPreview: "zMenu migration",
					errorMessage: code,
				},
				`migration-error:${step.id}:${input.leaseToken}`,
			);
		}
		await tx
			.update(steps)
			.set({ status: "interrupted", leaseExpiresAt: null, leaseOwner: null })
			.where(eq(steps.id, step.id));
		await tx
			.update(runs)
			.set({ status: row.status === "cancelled" ? "cancelled" : "paused" })
			.where(eq(runs.id, row.id));
		await event(tx, row, "step_interrupted", now, step.id, code);
	});
}

/** Recovery changes state only; it never starts a provider request. Called by startup/resume. */
export async function recoverExpiredRun(
	runId: string,
	now = new Date(),
): Promise<void> {
	await db.transaction(async (tx) => {
		const row = await lockRun(tx, runId);
		const active = await tx
			.select()
			.from(steps)
			.where(and(eq(steps.runId, runId), eq(steps.status, "running")));
		const expired = active.filter(
			(s) => !s.leaseExpiresAt || s.leaseExpiresAt <= now,
		);
		for (const step of expired) {
			await tx
				.update(steps)
				.set({ status: "interrupted", leaseOwner: null, leaseExpiresAt: null })
				.where(eq(steps.id, step.id));
			await event(tx, row, "step_interrupted", now, step.id, "lease_expired");
		}
		if (expired.length)
			await tx
				.update(runs)
				.set({ status: row.status === "cancelled" ? "cancelled" : "paused" })
				.where(eq(runs.id, runId));
		else if (
			row.status === "running" &&
			!active.length &&
			now.getTime() - row.updatedAt.getTime() >= MIGRATION_LEASE_MS
		) {
			await tx.update(runs).set({ status: "paused" }).where(eq(runs.id, runId));
			await event(
				tx,
				row,
				"dispatch_interrupted",
				now,
				undefined,
				"lease_expired",
			);
		}
	});
}
export async function blockRun(
	id: string,
	expectedRevision: number,
	code: string,
): Promise<MigrationRun> {
	await db.transaction(async (tx) => {
		const row = await lockRun(tx, id);
		if (row.revision !== expectedRevision)
			throw new MigrationInputError("revision_conflict");
		if (["completed", "cancelled"].includes(row.status))
			throw new MigrationInputError("invalid_transition");
		const active = await tx
			.select()
			.from(steps)
			.where(and(eq(steps.runId, id), eq(steps.status, "running")));
		if (active.length) throw new MigrationInputError("step_in_flight");
		const cleanCode = safeCode(code);
		await tx
			.update(runs)
			.set({
				status: "blocked",
				issues: [
					...(row.issues as MigrationRun["issues"]).slice(0, 999),
					{ code: cleanCode, message: cleanCode },
				],
			})
			.where(eq(runs.id, id));
		await event(tx, row, "blocked", new Date(), undefined, cleanCode);
	});
	return requireRun(id);
}
