export type AssistantTaskEvent = { type: string; [key: string]: unknown };
export interface AssistantTask {
  id: string;
  conversationId: string;
  message: string;
  status: "queued" | "running" | "stopping" | "completed" | "blocked" | "cancelled";
  events: AssistantTaskEvent[];
  createdAt: string;
  updatedAt: string;
}
function url(conversationId: string) {
  return `${import.meta.env.VITE_API_URL ?? "http://localhost:3001"}/api/v1/assistant/conversations/${encodeURIComponent(conversationId)}/tasks`;
}
export async function listAssistantTasks(
  conversationId: string,
  signal?: AbortSignal,
): Promise<AssistantTask[]> {
  const response = await fetch(url(conversationId), { credentials: "include", signal });
  if (!response.ok) throw new Error(`task_read_failed:${response.status}`);
  return (await response.json()).tasks;
}
export async function stopAssistantTask(
  conversationId: string,
  taskId: string,
): Promise<AssistantTask> {
  const response = await fetch(`${url(conversationId)}/${encodeURIComponent(taskId)}/stop`, {
    method: "POST",
    credentials: "include",
  });
  if (!response.ok) throw new Error(`task_stop_failed:${response.status}`);
  return (await response.json()).task;
}
