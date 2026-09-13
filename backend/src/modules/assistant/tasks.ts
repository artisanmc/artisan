import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db";
import { assistantConversations, assistantTasks } from "../../db/schema";
import { storeUploads } from "./uploads";

export type TaskEvent = { type: string; [key: string]: unknown };
export type AssistantTask = typeof assistantTasks.$inferSelect;
export function taskMatchesScope(
	task: AssistantTask,
	scope: { networkId: string; serverKeyId: string | null },
) {
	const metadata = (task.events as TaskEvent[]).find(
		(event) => event.type === "accepted",
	);
	return (
		metadata?.networkId === scope.networkId &&
		metadata.serverKeyId === scope.serverKeyId
	);
}
const active = ["queued", "running", "stopping"];
const controllers = new Map<string, AbortController>();

export async function getTask(conversationId: string, id: string) {
	const [task] = await db
		.select()
		.from(assistantTasks)
		.where(
			and(
				eq(assistantTasks.conversationId, conversationId),
				eq(assistantTasks.id, id),
			),
		);
	if (
		task &&
		active.includes(task.status) &&
		Date.now() - task.updatedAt.getTime() > 90_000
	) {
		const [blocked] = await db
			.update(assistantTasks)
			.set({
				status: "blocked",
				events: [
					...(task.events as TaskEvent[]),
					{
						type: "error",
						code: "task_worker_interrupted",
						at: new Date().toISOString(),
					},
				],
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(assistantTasks.id, id),
					eq(assistantTasks.updatedAt, task.updatedAt),
				),
			)
			.returning();
		return blocked ?? task;
	}
	return task;
}
export async function latestTask(conversationId: string) {
	const [task] = await db
		.select()
		.from(assistantTasks)
		.where(eq(assistantTasks.conversationId, conversationId))
		.orderBy(desc(assistantTasks.createdAt))
		.limit(1);
	return task ? getTask(conversationId, task.id) : undefined;
}
export async function taskByRequest(conversationId: string, requestId: string) {
	const [task] = await db
		.select()
		.from(assistantTasks)
		.where(
			and(
				eq(assistantTasks.conversationId, conversationId),
				eq(assistantTasks.requestId, requestId),
			),
		);
	return task;
}
export async function listTasks(conversationId: string) {
	const latest = await latestTask(conversationId);
	const rows = await db
		.select()
		.from(assistantTasks)
		.where(eq(assistantTasks.conversationId, conversationId))
		.orderBy(assistantTasks.createdAt);
	return rows.map((row) => (row.id === latest?.id ? latest : row));
}
export async function createTask(
	conversationId: string,
	requestId: string,
	requestHash: string,
	message: string,
	metadata: TaskEvent = { type: "accepted" },
	uploads?: { scope: { networkId: string; serverKeyId: string | null }; incoming: unknown },
) {
	return db.transaction(async (tx) => {
		await tx
			.select({ id: assistantConversations.id })
			.from(assistantConversations)
			.where(eq(assistantConversations.id, conversationId))
			.for("update");
		const [existing] = await tx
			.select()
			.from(assistantTasks)
			.where(
				and(
					eq(assistantTasks.conversationId, conversationId),
					eq(assistantTasks.requestId, requestId),
				),
			);
		if (existing) return { task: existing, created: false };
		const [running] = await tx
			.select()
			.from(assistantTasks)
			.where(
				and(
					eq(assistantTasks.conversationId, conversationId),
					inArray(assistantTasks.status, active),
				),
			);
		if (running) throw new Error("task_already_running");
		if (uploads) await storeUploads(tx, conversationId, uploads.scope, uploads.incoming);
		const now = new Date();
		const [task] = await tx
			.insert(assistantTasks)
			.values({
				id: crypto.randomUUID(),
				conversationId,
				requestId,
				requestHash,
				message,
				status: "queued",
				events: [metadata],
				createdAt: now,
				updatedAt: now,
			})
			.returning();
		return { task, created: true };
	});
}
export async function stopTask(conversationId: string, id: string) {
	await db
		.update(assistantTasks)
		.set({
			status: sql`case when status = 'queued' then 'cancelled' else 'stopping' end`,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(assistantTasks.id, id),
				eq(assistantTasks.conversationId, conversationId),
				inArray(assistantTasks.status, ["queued", "running"]),
			),
		);
	controllers.get(id)?.abort(new Error("task_stopped"));
	return getTask(conversationId, id);
}

export async function requeueMigrationTask(
	runId: string,
	conversationId: string,
) {
	return db.transaction(async (tx) => {
		await tx
			.select({ id: assistantConversations.id })
			.from(assistantConversations)
			.where(eq(assistantConversations.id, conversationId))
			.for("update");
		const rows = await tx
			.select()
			.from(assistantTasks)
			.where(eq(assistantTasks.conversationId, conversationId));
		const linked = rows.find((task) =>
			(task.events as TaskEvent[]).some(
				(event) => event.type === "migration_started" && event.runId === runId,
			),
		);
		if (!linked) return undefined;
		const [running] = await tx
			.select({ id: assistantTasks.id })
			.from(assistantTasks)
			.where(
				and(
					eq(assistantTasks.conversationId, linked.conversationId),
					inArray(assistantTasks.status, active),
				),
			);
		if (running) throw new Error("task_already_running");
		const [task] = await tx
			.update(assistantTasks)
			.set({ status: "queued", updatedAt: new Date() })
			.where(
				and(
					eq(assistantTasks.id, linked.id),
					eq(assistantTasks.status, "blocked"),
				),
			)
			.returning();
		if (!task) throw new Error("task_not_resumable");
		return task;
	});
}

/** Detached execution: HTTP consumers never own the worker's lifetime. */
export async function runTask(
	task: AssistantTask,
	execute: (
		publish: (event: TaskEvent) => Promise<void>,
		signal: AbortSignal,
	) => Promise<void>,
) {
	const [claimed] = await db
		.update(assistantTasks)
		.set({ status: "running", updatedAt: new Date() })
		.where(
			and(eq(assistantTasks.id, task.id), eq(assistantTasks.status, "queued")),
		)
		.returning();
	if (!claimed) return;
	const controller = new AbortController();
	controllers.set(task.id, controller);
	const events: TaskEvent[] = structuredClone(task.events) as TaskEvent[];
	let failed = false;
	let chain = Promise.resolve();
	const flush = () => {
		const snapshot = structuredClone(events);
		chain = chain.then(async () => {
			const [row] = await db
				.update(assistantTasks)
				.set({ events: snapshot, updatedAt: new Date() })
				.where(
					and(
						eq(assistantTasks.id, task.id),
						inArray(assistantTasks.status, ["running", "stopping"]),
					),
				)
				.returning({ status: assistantTasks.status });
			if (!row || row.status === "stopping")
				controller.abort(new Error("task_stopped"));
		});
		return chain;
	};
	let ticking = false;
	const timer = setInterval(() => {
		if (ticking) return;
		ticking = true;
		void flush()
			.catch(() => controller.abort(new Error("task_storage_failed")))
			.finally(() => {
				ticking = false;
			});
	}, 1000);
	try {
		await execute(async (event) => {
			controller.signal.throwIfAborted();
			if (event.type === "error") failed = true;
			const last = events.at(-1);
			if (
				["text", "reasoning"].includes(event.type) &&
				last?.type === event.type
			) {
				last.text = String(last.text ?? "") + String(event.text ?? "");
				last.at = new Date().toISOString();
			} else events.push({ ...event, at: new Date().toISOString() });
			if (!["text", "reasoning"].includes(event.type)) await flush();
		}, controller.signal);
	} catch (error) {
		failed = true;
		if (
			!controller.signal.aborted &&
			!events.some((event) => event.type === "error")
		) {
			events.push({
				type: "error",
				code: "task_execution_failed",
				at: new Date().toISOString(),
			});
		}
	} finally {
		clearInterval(timer);
		try {
			await flush();
			await db
				.update(assistantTasks)
				.set({
					events,
					status:
						controller.signal.reason?.message === "task_stopped"
							? "cancelled"
							: failed || controller.signal.aborted
								? "blocked"
								: "completed",
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(assistantTasks.id, task.id),
						inArray(assistantTasks.status, ["running", "stopping"]),
					),
				);
		} finally {
			controllers.delete(task.id);
		}
	}
}
