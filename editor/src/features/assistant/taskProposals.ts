import type { Project, ProjectId } from "@/domain/types";
import {
  projectToMenuV1,
  projectToCommandV1,
  projectToDialogV1,
} from "@/features/export/transform";
import type { AssistantTask } from "@/lib/api/assistantTasks";
import { useAccountStore } from "@/state/accountStore";
import { menuV1ToDomain } from "@/schema/menuV1ToDomain";
import { commandV1ToDomain } from "@/schema/commandV1ToDomain";
import { dialogV1ToDomain } from "@/schema/dialogV1ToDomain";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
function draftText(project: Project): string {
  return canonical(
    JSON.parse(
      JSON.stringify({
        menus: projectToMenuV1(project),
        commands: projectToCommandV1(project),
        dialogs: projectToDialogV1(project),
        translations: project.i18nKeys,
      }),
    ),
  );
}
async function digest(text: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function draftFingerprint(project: Project): Promise<string> {
  return digest(draftText(project));
}

export async function applyTaskProposals(task: AssistantTask, projectId: ProjectId): Promise<void> {
  const store = useAccountStore.getState();
  const project = store.account.projects.find((project) => project.id === projectId);
  if (!project) throw new Error("project_unavailable");
  const before = draftText(project);
  const baseHash = task.events.find((event) => event.type === "accepted")?.baseHash;
  if ((await digest(before)) !== baseHash) throw new Error("task_draft_conflict");
  const current = useAccountStore
    .getState()
    .account.projects.find((project) => project.id === projectId);
  if (!current || draftText(current) !== before) throw new Error("task_draft_conflict");
  const opts = { projectId, lang: current.defaultLang, translations: current.i18nKeys };
  const events = task.events as {
    type: string;
    menu?: Record<string, unknown>;
    command?: Record<string, unknown>;
    dialog?: Record<string, unknown>;
    id?: string;
    entries?: Record<string, Record<string, string>>;
  }[];
  for (const event of events) {
    const converted =
      event.type === "menu_written" && event.menu
        ? menuV1ToDomain(event.menu, opts)
        : event.type === "command_written" && event.command
          ? commandV1ToDomain(event.command, opts)
          : event.type === "dialog_written" && event.dialog
            ? dialogV1ToDomain(event.dialog, opts)
            : null;
    if (converted?.unsupported.length)
      throw new Error(`unsupported_proposal: ${converted.unsupported.join(", ")}`);
  }
  for (const event of events) {
    if (event.type === "menu_written" && event.menu)
      store.applyAssistantMenu({ projectId, menuV1: event.menu, lang: opts.lang });
    else if (event.type === "command_written" && event.command)
      store.applyAssistantCommand({ projectId, commandV1: event.command, lang: opts.lang });
    else if (event.type === "dialog_written" && event.dialog)
      store.applyAssistantDialog({ projectId, dialogV1: event.dialog, lang: opts.lang });
    else if (["menu_deleted", "command_deleted", "dialog_deleted"].includes(event.type) && event.id)
      store.deleteFromProject({ projectId, nodeIds: [event.id] });
    else if (event.type === "translations_written" && event.entries)
      store.applyAssistantTranslations({ projectId, entries: event.entries });
  }
}
