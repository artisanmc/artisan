import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";
import {
  type AssistantTask,
  listAssistantTasks,
  stopAssistantTask,
} from "@/lib/api/assistantTasks";

export function TaskTimeline({
  conversationId,
  refresh,
  onBusy,
  onTranscriptOffset,
  onApply,
  renderMigration,
}: {
  conversationId: string | null;
  refresh: number;
  onBusy: (busy: boolean) => void;
  onTranscriptOffset: (offset: number) => void;
  onApply: (task: AssistantTask) => Promise<void>;
  renderMigration?: (runId: string) => ReactNode;
}) {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<AssistantTask[]>([]);
  const [connected, setConnected] = useState(true);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  const [applying, setApplying] = useState<string>();
  const [applied, setApplied] = useState<string[]>([]);
  const callbacks = useRef({ onBusy, onTranscriptOffset });
  callbacks.current = { onBusy, onTranscriptOffset };
  const text = (key: string) => t(`assistant.tasks.${key}`);
  const action = (name: unknown) => {
    const key = (
      {
        read_source: "reading",
        search_sources: "reading",
        list_sources: "reading",
        read_attachment: "reading",
        upsert_menu: "writeMenu",
        get_menu: "menus",
        list_menus: "menus",
        upsert_command: "writeCommand",
        upsert_dialog: "writeDialog",
      } as Record<string, string>
    )[String(name)];
    if (key) return t(`assistant.activity.${key}`);
    if (name === "model") return text("waiting");
    if (name === "menu_completed") return text("menusReady");
    if (name === "migration_planned" || name === "migration_resumed") return text("running");
    return String(name ?? text("waiting"));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: an accepted task explicitly refreshes tracking.
  useEffect(() => {
    setTasks([]);
    setApplied([]);
    if (!conversationId) {
      callbacks.current.onBusy(false);
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const poll = async () => {
      let delay = 2000;
      try {
        const rows = await listAssistantTasks(conversationId, controller.signal);
        if (controller.signal.aborted) return;
        setTasks(rows);
        setConnected(true);
        callbacks.current.onBusy(
          rows.some((task) => ["queued", "running", "stopping"].includes(task.status)),
        );
        if (!rows.some((task) => ["queued", "running", "stopping"].includes(task.status)))
          delay = 10000;
        const offset = rows[0]?.events.find((event) => event.type === "accepted")?.messageOffset;
        if (typeof offset === "number") callbacks.current.onTranscriptOffset(offset);
      } catch {
        if (!controller.signal.aborted) setConnected(false);
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), delay);
      }
    };
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [conversationId, refresh]);
  async function stop(task: AssistantTask) {
    try {
      const updated = await stopAssistantTask(task.conversationId, task.id);
      setTasks((rows) => rows.map((row) => (row.id === updated.id ? updated : row)));
    } catch {
      setError(text("stopFailed"));
    }
  }
  return (
    <div className="flex flex-col gap-4" data-testid="assistant-task-timeline">
      {!connected && (
        <output className="text-sm text-[var(--text-mut)]">{text("disconnected")}</output>
      )}
      {tasks.map((task) => {
        const running = ["queued", "running", "stopping"].includes(task.status);
        const activity = task.events.filter((event) =>
          ["activity", "tool", "error"].includes(event.type),
        );
        const last = activity.at(-1);
        const elapsed = Math.max(
          0,
          Math.floor(
            ((running ? now : Date.parse(task.updatedAt)) - Date.parse(task.createdAt)) / 1000,
          ),
        );
        const answer = task.events
          .filter((event) => event.type === "text")
          .map((event) => String(event.text ?? ""))
          .join("");
        const reasoning = task.events
          .filter((event) => event.type === "reasoning")
          .map((event) => String(event.text ?? ""))
          .join("");
        const proposals = task.events.filter((event) => /_(written|deleted)$/.test(event.type));
        const migration = task.events.find((event) => event.type === "migration_started");
        const files = task.events.find((event) => event.type === "accepted")?.files;
        const failure = task.events.filter((event) => event.type === "error").at(-1);
        const lastSignal = task.events
          .filter((event) => ["text", "reasoning", "activity", "tool"].includes(event.type))
          .at(-1);
        const silence = lastSignal?.at
          ? Math.max(0, Math.floor((now - Date.parse(String(lastSignal.at))) / 1000))
          : elapsed;
        const completedMenus = task.events.filter(
          (event) => event.type === "activity" && event.name === "menu_completed",
        ).length;
        return (
          <section
            key={task.id}
            className="flex flex-col gap-2 border-b border-[var(--border-soft)] pb-4"
          >
            <p className="self-end rounded-[10px] bg-[var(--surface-hover)] px-3 py-1.5 text-sm">
              {task.message || text("files")}
            </p>
            <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-mut)]">
              <output className="flex items-center gap-2">
                {running && (
                  <LoaderCircle aria-hidden className="h-3.5 w-3.5 motion-safe:animate-spin" />
                )}
                {text(task.status)} · {elapsed}s
              </output>
              {running && (
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  disabled={task.status === "stopping"}
                  onClick={() => void stop(task)}
                >
                  {text("stop")}
                </button>
              )}
            </div>
            {running && (
              <p className="text-xs text-[var(--text-mut)]">
                {last?.name
                  ? `${text("action")}: ${action(last.name)} ${String(last.target ?? "")}`
                  : text("waiting")}
              </p>
            )}
            {running && silence >= 15 && (
              <p className="text-xs text-[var(--text-mut)]">
                {text("lastActivity")}: {silence}s.{" "}
                {now - Date.parse(task.updatedAt) < 15000
                  ? text("workerConnected")
                  : text("workerSilent")}
              </p>
            )}
            {completedMenus > 0 && (
              <p className="text-xs text-[var(--text-mut)]">
                {text("menusReady")}: {completedMenus}
              </p>
            )}
            {Array.isArray(files) && files.length > 0 && (
              <details className="text-xs text-[var(--text-mut)]">
                <summary className="cursor-pointer">
                  {text("files")} ({files.length})
                </summary>
                <ul className="max-h-40 overflow-auto py-2">
                  {files.map((file) => (
                    <li key={String(file)}>{String(file)}</li>
                  ))}
                </ul>
              </details>
            )}
            {task.status === "blocked" && (
              <p role="alert" className="text-xs text-[var(--danger)]">
                {text("blockedHelp")}
                {failure ? ` (${String(failure.code ?? failure.message ?? "")})` : ""}
              </p>
            )}
            {answer && <div className="whitespace-pre-wrap text-sm">{answer}</div>}
            {migration && renderMigration?.(String(migration.runId))}
            {reasoning && (
              <details className="text-xs text-[var(--text-mut)]">
                <summary className="cursor-pointer">{text("reasoning")}</summary>
                <p className="max-h-64 overflow-auto whitespace-pre-wrap py-2">{reasoning}</p>
              </details>
            )}
            <details className="text-xs text-[var(--text-mut)]">
              <summary className="cursor-pointer">
                {text("activity")} ({activity.length})
              </summary>
              <ol className="my-2 flex flex-col gap-1">
                {activity.map((event, index) => (
                  <li key={`${task.id}-${index}`}>
                    {event.type === "error"
                      ? `${text("error")}: ${String(event.code ?? event.message ?? "")}`
                      : `${String(event.name ?? text("waiting"))} ${String(event.target ?? "")} ${event.type === "tool" ? (event.ok ? "✓" : text("correcting")) : "…"}`}
                  </li>
                ))}
              </ol>
            </details>
            {proposals.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer">
                  {text("proposals")} ({proposals.length})
                </summary>
                <pre className="max-h-64 overflow-auto py-2">
                  {JSON.stringify(proposals, null, 2)}
                </pre>
              </details>
            )}
            {!running && proposals.length > 0 && (
              <button
                type="button"
                className="btn btn-sm btn-primary self-start"
                disabled={applying !== undefined || applied.includes(task.id)}
                onClick={async () => {
                  setApplying(task.id);
                  setError("");
                  try {
                    await onApply(task);
                    setApplied((ids) => [...ids, task.id]);
                  } catch (error) {
                    setError(error instanceof Error ? error.message : text("applyFailed"));
                  } finally {
                    setApplying(undefined);
                  }
                }}
              >
                {text(applied.includes(task.id) ? "applied" : "apply")}
              </button>
            )}
          </section>
        );
      })}
      {error && (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      )}
    </div>
  );
}
