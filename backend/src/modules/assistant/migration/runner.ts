import { MigrationPausedError } from "./continuation";
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
import { convertMigrationStep, convertAgentTask } from "./planner";
import { discoverMigration, type AgentInput } from "./agent";
import {
	type ClaimedMigrationStep,
	claimNextStep,
	completeStep,
	completeCompression,
	completeDiscovery,
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
		let compressionCredits = 0;
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
			deps.stepTimeoutMs ??
				(claim.run.manifest.agent && !claim.run.manifest.agent.tasks
					? 900000
					: 240000),
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
			promptPreview: "Menu migration",
		});
		try {
			await requireCurrentAccess(claim);
			model = await getModel(claim.run.modelId);
			if (!model?.isActive) throw new MigrationInputError("model_unavailable");
			const provider = await (deps.providerFor ?? createProviderFor)(model);
			if (!provider) throw new MigrationInputError("model_unavailable");
			const balance = await getBalance(claim.networkId);
			if (balance <= 0) throw new MigrationInputError("insufficient_credits");
			const settings = await getAiSettings();
			const stepBudget = Math.min(
				balance,
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
			const agentInput: AgentInput & {
				sourceFileId: string;
				targetId: string;
			} = {
				provider,
				continuation: claim.continuation,
				onCompacted: async (continuation) => {
					controller.signal.throwIfAborted();
					if (!usages.length) throw new MigrationInputError("provider_error");
					await requireCurrentAccess(claim);
					await completeCompression({
						runId,
						stepId: claim.step.id,
						leaseToken: claim.leaseToken,
						continuation,
						usageInput: usageInput(activeModel),
					});
					compressionCredits += computeCreditsCharged(
						sumUsage(usages),
						activeModel,
					);
					usages.length = 0;
				},
				model: model.providerModelId,
				manifest: claim.run.manifest,
				sourceFileId: claim.step.sourceFileId,
				targetId: claim.step.targetId,
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
					compressionCredits +
						computeCreditsCharged(sumUsage(usages), activeModel) <
					stepBudget,
			};
			const discovery = Boolean(
				claim.run.manifest.agent && !claim.run.manifest.agent.tasks,
			);
			const discovered = discovery
				? await discoverMigration(agentInput)
				: undefined;
			const proposal = discovery
				? undefined
				: claim.run.manifest.agent
					? await convertAgentTask(agentInput)
					: await convertMigrationStep(agentInput);
			controller.signal.throwIfAborted();
			if (!usages.length) throw new MigrationInputError("provider_error");
			await stopMonitoring();
			controller.signal.throwIfAborted();
			await requireCurrentAccess(claim);
			if (discovered)
				await completeDiscovery({
					runId,
					stepId: claim.step.id,
					leaseToken: claim.leaseToken,
					manifest: discovered,
					usageInput: usageInput(model),
				});
			else if (proposal)
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
					...(error instanceof MigrationPausedError
						? { continuation: error.continuation }
						: {}),
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
