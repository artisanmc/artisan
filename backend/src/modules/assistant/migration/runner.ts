import { eq } from "drizzle-orm";
import { db } from "../../../db";
import { projects } from "../../../db/schema";
import { resolveProjectAccess } from "../../../lib/projectAccess";
import { getBalance } from "../../ai/creditsRepo";
import { type AiModel, getModel } from "../../ai/modelRepo";
import { computeCreditsCharged, sumUsage } from "../../ai/pricing";
import { createProviderFor } from "../../ai/providers";
import { getAiSettings } from "../../ai/settings";
import type { LlmProvider, LlmUsage } from "../provider/types";
import {
	type ImportSourcesReadFn,
	resolveServerAttachments,
} from "../serverAttachments";
import { assistantFailureCode } from "../transport";
import { verifyManifestSources } from "./manifest";
import { convertMigrationStep } from "./planner";
import {
	type ClaimedMigrationStep,
	claimNextStep,
	completeStep,
	getRunContext,
	interruptStep,
	renewLease,
} from "./repository";
import { MigrationInputError } from "./types";

export interface MigrationRunnerDependencies {
	providerFor?: (model: AiModel) => Promise<LlmProvider | null>;
	readSources?: ImportSourcesReadFn;
	leaseIntervalMs?: number;
	stepTimeoutMs?: number;
}

async function requireCurrentAccess(
	claim: ClaimedMigrationStep,
): Promise<void> {
	const access = await resolveProjectAccess(
		claim.ownerKey,
		claim.run.projectId,
	);
	if (!access.ok) throw new MigrationInputError(access.error);
	const [project] = await db
		.select({ deletedAt: projects.deletedAt })
		.from(projects)
		.where(eq(projects.id, claim.run.projectId));
	if (!project || project.deletedAt)
		throw new MigrationInputError("project_not_found");
	if (
		access.networkId !== claim.networkId ||
		access.serverKeyId !== claim.serverKeyId
	)
		throw new MigrationInputError("scope_changed");
}

/** Detached from HTTP/SSE. SQL leases, not this process, arbitrate concurrent dispatches. */
export function dispatchMigration(runId: string): void {
	void executeMigration(runId).catch(() => {
		console.warn("[assistant-migration]", { runId, code: "migration_error" });
	});
}

export async function executeMigration(
	runId: string,
	deps: MigrationRunnerDependencies = {},
): Promise<void> {
	const workerId = crypto.randomUUID();
	while (true) {
		const claim = await claimNextStep(runId, workerId);
		if (!claim) return;
		const started = performance.now();
		const usages: LlmUsage[] = [];
		let model: AiModel | null = null;
		const controller = new AbortController();
		let renewing: Promise<void> | undefined;
		const timer = setInterval(() => {
			if (renewing) return;
			renewing = renewLease(runId, claim.step.id, claim.leaseToken)
				.then((ok) => {
					if (!ok) controller.abort(new MigrationInputError("lease_lost"));
				})
				.catch(() => {
					controller.abort(new MigrationInputError("lease_lost"));
				})
				.finally(() => {
					renewing = undefined;
				});
		}, deps.leaseIntervalMs ?? 25000);
		const timeout = setTimeout(
			() => controller.abort(new MigrationInputError("provider_timeout")),
			deps.stepTimeoutMs ?? 240000,
		);
		const stopMonitoring = async () => {
			clearInterval(timer);
			clearTimeout(timeout);
			await renewing;
		};
		const usageInput = (activeModel: AiModel) => ({
			networkId: claim.networkId,
			userId: claim.ownerKey.slice(5),
			serverKeyId: claim.serverKeyId,
			model: activeModel,
			conversationId: claim.run.conversationId,
			actionType: "migration",
			usage: sumUsage(usages),
			durationMs: Math.round(performance.now() - started),
			promptPreview: "zMenu migration",
		});
		try {
			await requireCurrentAccess(claim);
			model = await getModel(claim.run.modelId);
			if (!model?.isActive) throw new MigrationInputError("model_unavailable");
			const provider = await (deps.providerFor ?? createProviderFor)(model);
			if (!provider) throw new MigrationInputError("model_unavailable");
			const balance = await getBalance(claim.networkId);
			if (balance <= 0)
				throw new MigrationInputError("migration_budget_exceeded");
			const settings = await getAiSettings();
			const stepBudget = Math.min(
				balance,
				claim.run.budget.maxCredits - claim.run.budget.usedCredits,
				settings.maxCreditsPerTurn ?? Number.POSITIVE_INFINITY,
			);
			const groups = new Map<string, string[]>();
			for (const entry of claim.run.manifest.entries)
				groups.set(entry.sourceId, [
					...(groups.get(entry.sourceId) ?? []),
					entry.path,
				]);
			const resolved = await resolveServerAttachments(
				claim.serverKeyId,
				[...groups].map(([sourceId, paths]) => ({ sourceId, paths })),
				deps.readSources,
			);
			if (!resolved.ok) throw new MigrationInputError(resolved.error);
			const issues = verifyManifestSources(
				claim.run.manifest,
				resolved.attachments,
			);
			if (issues.length) throw new MigrationInputError(issues[0].code);
			const activeModel = model;
			const proposal = await convertMigrationStep({
				provider,
				model: model.providerModelId,
				manifest: claim.run.manifest,
				sourceFileId: claim.step.sourceFileId,
				attachments: resolved.attachments,
				contextTokens: claim.run.budget.contextTokens,
				maxOutputTokens: claim.run.budget.maxOutputTokens,
				signal: controller.signal,
				onUsage: (usage) => {
					if (
						![
							usage.inputTokens,
							usage.outputTokens,
							usage.cachedInputTokens ?? 0,
						].every((n) => Number.isSafeInteger(n) && n >= 0)
					)
						throw new MigrationInputError("provider_error");
					usages.push(usage);
				},
				canCall: () =>
					computeCreditsCharged(sumUsage(usages), activeModel) < stepBudget,
			});
			controller.signal.throwIfAborted();
			if (!usages.length) throw new MigrationInputError("provider_error");
			await stopMonitoring();
			controller.signal.throwIfAborted();
			await requireCurrentAccess(claim);
			await completeStep({
				runId,
				stepId: claim.step.id,
				leaseToken: claim.leaseToken,
				proposal,
				usageInput: usageInput(model),
			});
		} catch (error) {
			const reason = controller.signal.aborted
				? controller.signal.reason
				: error;
			const code =
				reason instanceof MigrationInputError
					? reason.code
					: assistantFailureCode(reason);
			try {
				await interruptStep({
					runId,
					stepId: claim.step.id,
					leaseToken: claim.leaseToken,
					code,
					...(model && usages.length ? { usageInput: usageInput(model) } : {}),
				});
			} catch {
				/* A lost lease cannot checkpoint or report on behalf of its new owner. */
			}
			return;
		} finally {
			await stopMonitoring();
		}
		const current = await getRunContext(runId);
		if (!current || current.run.status !== "running") return;
	}
}
