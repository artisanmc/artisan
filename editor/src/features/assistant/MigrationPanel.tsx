import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProjectId } from "@/domain/types";
import {
	type CreateMigrationInput,
	type MigrationAction,
	type MigrationEvent,
	type MigrationProposal,
	MigrationRequestError,
	type MigrationRun,
	controlMigration,
	createMigration,
	getMigration,
	getMigrationEvents,
	getMigrationProposals,
	listMigrations,
} from "@/lib/api/assistantMigration";
import { useAccountStore } from "@/state/accountStore";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ServerAttachmentGroup } from "./ServerImportSourceDialog";
import {
	applyMigrationProposal,
	canPersistMigrationDraft,
	inspectMigrationProposal,
} from "./migrationProposal";

interface Props {
	projectId: ProjectId;
	conversationId: string | null;
	ensureConversation(): Promise<string>;
	modelId: string | null;
	groups: ServerAttachmentGroup[];
	disabled: boolean;
}
export function MigrationPanel({
	projectId,
	conversationId,
	ensureConversation,
	modelId,
	groups,
	disabled,
}: Props) {
	const { t } = useTranslation();
	const inputId = useId();
	const project = useAccountStore((s) =>
		s.account.projects.find((p) => p.id === projectId),
	);
	const [runs, setRuns] = useState<MigrationRun[]>([]);
	const [selected, setSelected] = useState("");
	const [proposals, setProposals] = useState<MigrationProposal[]>([]);
	const [eventCode, setEventCode] = useState<string>();
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const [busy, setBusy] = useState(false);
	const [setup, setSetup] = useState(false);
	const [mappings, setMappings] = useState<Record<string, string>>({});
	const [storageAvailable, setStorageAvailable] = useState(true);
	const [refresh, setRefresh] = useState(0);
	const lock = useRef(false);
	const alive = useRef(true);
	const scope = useRef(projectId);
	scope.current = projectId;
	const conversationScope = useRef(conversationId);
	conversationScope.current = conversationId;
	const creation = useRef<
		{ fingerprint: string; input: CreateMigrationInput } | undefined
	>(undefined);
	const run = runs.find((r) => r.id === selected) ?? runs[0];
	const showError = useCallback(
		(e: unknown) =>
			setError(e instanceof MigrationRequestError ? e.code : "migration_error"),
		[],
	);
	const mergeRun = useCallback(
		(incoming: MigrationRun) =>
			setRuns((current) => {
				if (
					incoming.projectId !== scope.current ||
					incoming.conversationId !== conversationScope.current
				)
					return current;
				const previous = current.find((r) => r.id === incoming.id);
				if (previous && previous.revision > incoming.revision) return current;
				return previous
					? current.map((r) => (r.id === incoming.id ? incoming : r))
					: [incoming, ...current];
			}),
		[],
	);
	useEffect(() => {
		alive.current = true;
		setStorageAvailable(canPersistMigrationDraft());
		return () => {
			alive.current = false;
		};
	}, []);
	useEffect(() => {
		const controller = new AbortController();
		setRuns([]);
		setSelected("");
		setProposals([]);
		setError("");
		if (!conversationId) return () => controller.abort();
		setLoading(true);
		void listMigrations(conversationId, controller.signal)
			.then((list) => {
				if (!controller.signal.aborted)
					setRuns((current) => [
						...current,
						...list.filter(
							(r) =>
								r.projectId === projectId &&
								!current.some((old) => old.id === r.id),
						),
					]);
			})
			.catch((e) => {
				if (!controller.signal.aborted) showError(e);
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [conversationId, projectId, showError]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: initialize editable fields only when selecting another run, never overwrite edits during polling
	useEffect(() => {
		if (!run) return;
		setMappings(
			Object.fromEntries(
				run.manifest.entries
					.filter((e) => e.targetId !== null)
					.map((e) => [e.fileId, e.targetId ?? ""]),
			),
		);
	}, [run?.id]);
	const selectedRunId = run?.id;
	// biome-ignore lint/correctness/useExhaustiveDependencies: refresh deliberately restarts the passive read after an explicit control action
	useEffect(() => {
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		setProposals([]);
		setEventCode(undefined);
		if (!conversationId || !selectedRunId) return () => controller.abort();
		const runId = selectedRunId;
		let cursor = 0;
		const poll = async () => {
			try {
				const updated = await getMigration(
					conversationId,
					runId,
					controller.signal,
				);
				const results = await getMigrationProposals(
					conversationId,
					runId,
					controller.signal,
				);
				let page: MigrationEvent[];
				const events: MigrationEvent[] = [];
				do {
					page = await getMigrationEvents(
						conversationId,
						runId,
						controller.signal,
						cursor,
					);
					events.push(...page);
					cursor = page.at(-1)?.sequence ?? cursor;
				} while (page.length === 200 && !controller.signal.aborted);
				if (
					controller.signal.aborted ||
					updated.projectId !== projectId ||
					updated.conversationId !== conversationId
				)
					return;
				mergeRun(updated);
				setProposals(results);
				if (events.length) setEventCode(events.at(-1)?.code);
				timer = setTimeout(() => void poll(), 3000);
			} catch (e) {
				if (!controller.signal.aborted) {
					showError(e);
					timer = setTimeout(() => void poll(), 5000);
				}
			}
		};
		void poll();
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [conversationId, projectId, selectedRunId, refresh, mergeRun, showError]);

	async function startSelection(reanalyze = false) {
		if (lock.current || disabled || (!modelId && !reanalyze)) return;
		lock.current = true;
		setBusy(true);
		setError("");
		const expectedProject = projectId;
		let expectedConversation = conversationId;
		const isCurrent = () =>
			alive.current &&
			scope.current === expectedProject &&
			conversationScope.current === expectedConversation;
		try {
			const id = await ensureConversation();
			if (
				expectedConversation === null &&
				(conversationScope.current === null || conversationScope.current === id)
			)
				expectedConversation = conversationScope.current;
			if (!isCurrent()) return;
			const serverAttachments =
				reanalyze && run
					? [...new Set(run.manifest.entries.map((e) => e.sourceId))].map(
							(sourceId) => ({
								sourceId,
								paths: run.manifest.entries
									.filter((e) => e.sourceId === sourceId)
									.map((e) => e.path),
							}),
						)
					: groups.map((g) => ({
							sourceId: g.sourceId,
							paths: g.files.map((f) => f.path).sort(),
						}));
			const data = {
				modelId: reanalyze && run ? run.modelId : (modelId ?? ""),
				serverAttachments,
				existingTargetIds: project?.menus.map((m) => m.id) ?? [],
				...(reanalyze ? { targetIds: mappings } : {}),
			};
			const fingerprint = JSON.stringify({ id, ...data });
			if (creation.current?.fingerprint !== fingerprint)
				creation.current = {
					fingerprint,
					input: { ...data, requestId: crypto.randomUUID() },
				};
			const created = await createMigration(id, creation.current.input);
			if (expectedConversation === null && conversationScope.current === id)
				expectedConversation = id;
			if (!isCurrent()) return;
			mergeRun(created);
			setSelected(created.id);
			setSetup(false);
			creation.current = undefined;
			if (created.status === "ready" && isCurrent()) {
				const started = await controlMigration(
					id,
					created.id,
					"start",
					created.revision,
				);
				if (isCurrent()) {
					mergeRun(started);
					setRefresh((n) => n + 1);
				}
			}
		} catch (e) {
			if (isCurrent()) showError(e);
		} finally {
			lock.current = false;
			if (alive.current) setBusy(false);
		}
	}
	async function control(action: MigrationAction) {
		if (!run || !conversationId || lock.current) return;
		lock.current = true;
		setBusy(true);
		setError("");
		const expectedProject = projectId;
		const expectedConversation = conversationId;
		const isCurrent = () =>
			alive.current &&
			scope.current === expectedProject &&
			conversationScope.current === expectedConversation;
		try {
			const updated = await controlMigration(
				conversationId,
				run.id,
				action,
				run.revision,
			);
			if (isCurrent()) {
				mergeRun(updated);
				setRefresh((n) => n + 1);
			}
		} catch (e) {
			if (isCurrent()) {
				showError(e);
				setRefresh((n) => n + 1);
			}
		} finally {
			lock.current = false;
			if (alive.current) setBusy(false);
		}
	}
	async function apply(proposal: MigrationProposal | MigrationProposal[]) {
		if (
			!run ||
			run.projectId !== projectId ||
			run.conversationId !== conversationId ||
			lock.current
		)
			return;
		lock.current = true;
		setBusy(true);
		setError("");
		try {
			const isCurrent = () =>
				alive.current &&
				scope.current === projectId &&
				conversationScope.current === conversationId;
			for (const item of Array.isArray(proposal) ? proposal : [proposal]) {
				if (!isCurrent()) return;
				const result = await applyMigrationProposal(item, projectId, {
					isCurrent,
				});
				if (!isCurrent()) return;
				if (result.status === "applied")
					setStorageAvailable(result.storageAvailable);
				else if (result.status !== "already_applied")
					setError(result.code ?? result.status);
			}
		} catch (e) {
			if (alive.current && scope.current === projectId) showError(e);
		} finally {
			lock.current = false;
			if (alive.current) setBusy(false);
		}
	}
	const text = (key: string) => t(`assistant.migration.${key}`);
	const issueText = (code: string) =>
		t(`assistant.migration.errors.${code}`, {
			defaultValue: text("errors.migration_error"),
		});
	const applied = proposals.filter(
		(p) => inspectMigrationProposal(p, projectId).status === "already_applied",
	).length;
	const generated =
		run?.steps.filter((s) => s.sourceFileId && s.status === "completed")
			.length ?? 0;
	const exploring = Boolean(run?.manifest.agent && !run.manifest.agent.tasks);
	if (!groups.length && !conversationId) return null;
	return (
		<section
			aria-label={text("title")}
			className="flex flex-col gap-3 border-b border-[var(--border-soft)] py-3 text-sm"
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="font-medium">{text("title")}</h3>
				{groups.length > 0 && (
					<Button
						size="sm"
						variant="secondary"
						disabled={disabled || busy}
						onClick={() => setSetup((v) => !v)}
					>
						{text("selection")}
					</Button>
				)}
			</div>
			{loading && <output>{text("loading")}</output>}
			{setup && (
				<div className="flex flex-col gap-2">
					<p>{text("exploreHelp")}</p>
					<p className="text-xs text-[var(--text-mut)]">{text("budgetHelp")}</p>
					<Button
						disabled={busy || disabled || !modelId}
						onClick={() => void startSelection()}
					>
						{busy ? text("working") : text("start")}
					</Button>
				</div>
			)}
			{runs.length > 1 && (
				<label>
					{text("history")}
					<select
						className="input w-full"
						value={run?.id}
						onChange={(e) => setSelected(e.target.value)}
					>
						{runs.map((r) => (
							<option key={r.id} value={r.id}>
								{new Date(r.createdAt).toLocaleString()} —{" "}
								{r.steps.filter((s) => s.sourceFileId).length} {text("menus")}
							</option>
						))}
					</select>
				</label>
			)}
			{run && (
				<>
					<div aria-live="polite">
						<p>
							{exploring && run.status === "running"
								? text("exploring")
								: text(`status.${run.status}`)}
						</p>
						<p>
							{!exploring &&
								t("assistant.migration.progress", {
									generated,
									total: run.steps.filter((s) => s.sourceFileId).length,
									applied,
								})}
						</p>
						<p className="text-xs text-[var(--text-mut)]">
							{t("assistant.migration.spent", {
								used: run.budget.usedCredits,
							})}
						</p>
						{run.steps.find((s) => s.status === "running") && (
							<p>
								{text("active")}{" "}
								{run.steps.find((s) => s.status === "running")?.targetId ||
									text("exploring")}
							</p>
						)}
					</div>
					<div className="flex flex-wrap gap-2">
						{run.status === "ready" && (
							<Button
								disabled={busy || disabled}
								onClick={() => void control("start")}
							>
								{text("start")}
							</Button>
						)}
						{run.status === "paused" && (
							<Button
								disabled={busy || disabled}
								onClick={() => void control("resume")}
							>
								{text("resume")}
							</Button>
						)}
						{run.status === "running" && (
							<Button
								variant="secondary"
								disabled={busy}
								onClick={() => void control("pause")}
							>
								{text("pause")}
							</Button>
						)}
						{!["completed", "cancelled"].includes(run.status) && (
							<Button
								variant="secondary"
								disabled={busy}
								onClick={() => void control("cancel")}
							>
								{text("cancel")}
							</Button>
						)}
					</div>
					{eventCode && (
						<p className="text-[var(--text-mut)]">
							<span>{issueText(eventCode)}</span> <code>{eventCode}</code>
						</p>
					)}
					{run.issues.length > 0 && (
						<ul className="text-xs text-[var(--text-mut)]">
							{run.issues.map((issue, i) => (
								<li key={`${issue.code}/${issue.fileId}/${i}`}>
									{issue.fileId && `${issue.fileId}: `}
									{issueText(issue.code)} {issue.reference}
								</li>
							))}
						</ul>
					)}
					{run.manifest.agent?.reports && (
						<details>
							<summary>{text("explorationReport")}</summary>
							<ul className="text-xs text-[var(--text-mut)]">
								{run.manifest.agent.reports.map((report) => (
									<li key={report.fileId}>
										<strong>{report.fileId}</strong>: {report.notes}
									</li>
								))}
							</ul>
						</details>
					)}
					{run.status === "blocked" && (
						<details>
							<summary className="cursor-pointer">{text("reanalyze")}</summary>
							<p className="my-2 text-xs">{text("reanalyzeHelp")}</p>
							{run.manifest.entries
								.filter((e) => e.kind === "menu")
								.map((entry) => (
									<label
										htmlFor={`${inputId}/${entry.fileId}`}
										className="my-2 block"
										key={entry.fileId}
									>
										{entry.path}
										<Input
											id={`${inputId}/${entry.fileId}`}
											aria-label={entry.path}
											value={mappings[entry.fileId] ?? ""}
											onChange={(e) =>
												setMappings((m) => ({
													...m,
													[entry.fileId]: e.target.value,
												}))
											}
										/>
									</label>
								))}
							<Button
								disabled={busy || disabled}
								onClick={() => void startSelection(true)}
							>
								{text("analyzeAgain")}
							</Button>
						</details>
					)}
					{proposals.length > 0 && (
						<>
							<p className="text-xs">{text("draftHelp")}</p>
							<Button
								variant="secondary"
								disabled={
									busy ||
									!proposals.some(
										(p) =>
											inspectMigrationProposal(p, projectId).status ===
											"available",
									)
								}
								onClick={() =>
									void apply(
										proposals.filter(
											(p) =>
												inspectMigrationProposal(p, projectId).status ===
												"available",
										),
									)
								}
							>
								{text("applyAll")}
							</Button>
							<ul className="flex flex-col gap-2">
								{proposals.map((proposal) => {
									const status = inspectMigrationProposal(
										proposal,
										projectId,
									).status;
									return (
										<li
											className="flex flex-wrap items-center justify-between gap-2"
											key={proposal.id}
										>
											<span>
												{proposal.targetId} — {text(`applyStatus.${status}`)}
												{proposal.issues.length > 0 && (
													<span className="block text-xs text-[var(--text-mut)]">
														{text("verify")}{" "}
														{proposal.issues
															.map((i) =>
																i.code === "conversion_limitation"
																	? i.message
																	: issueText(i.code),
															)
															.join(" ")}
													</span>
												)}
											</span>
											<Button
												size="sm"
												variant="secondary"
												disabled={busy || status !== "available"}
												onClick={() => void apply(proposal)}
											>
												{text("apply")}
											</Button>
										</li>
									);
								})}
							</ul>
						</>
					)}
				</>
			)}
			{!storageAvailable && (
				<p role="alert" className="text-[var(--danger)]">
					{text("storageWarning")}
				</p>
			)}
			{error && (
				<p role="alert" className="text-[var(--danger)]">
					{issueText(error)}
				</p>
			)}
			{busy && <output>{text("working")}</output>}
		</section>
	);
}
