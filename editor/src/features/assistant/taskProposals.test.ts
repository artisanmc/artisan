import { expect, it } from "vitest";
import { useAccountStore } from "@/state/accountStore";
import { applyTaskProposals, draftFingerprint } from "./taskProposals";
import type { AssistantTask } from "@/lib/api/assistantTasks";
it("applies menus, dialogs, commands and translations from one ordinary task", async () => {
  useAccountStore.getState().setAccount({ id: "a", projects: [], projectOrder: [] } as never);
  useAccountStore.getState().createProject({ id: "mixed-task" });
  const project = useAccountStore.getState().account.projects[0];
  const task = { status: "completed", events: [
    { type: "accepted", baseHash: await draftFingerprint(project) },
    { type: "menu_written", menu: { schema: "menu/v1", id: "shop", size: 9, title: [], layers: [{ id: "base", name: "Base", elements: [] }] } },
    { type: "dialog_written", dialog: { schema: "dialog/v1", id: "confirm", title: "Confirm", buttons: [{ id: "ok", label: "OK", actions: "close_dialog" }] } },
    { type: "command_written", command: { schema: "command/v1", id: "shop_command", name: "shop", actions: "open_menu shop" } },
    { type: "translations_written", entries: { welcome: { fr: "Bienvenue" } } },
  ] } as AssistantTask;
  await applyTaskProposals(task, project.id);
  const updated = useAccountStore.getState().account.projects[0];
  expect(updated.menus.some((menu) => menu.id === "shop")).toBe(true);
  expect(updated.dialogs.some((dialog) => dialog.id === "confirm")).toBe(true);
  expect(updated.commands.some((command) => command.id === "shop_command")).toBe(true);
  expect(updated.i18nKeys.welcome).toEqual({ fr: "Bienvenue" });
});
it("applies a finished proposal only after explicit approval", async () => {
  useAccountStore.getState().setAccount({ id: "a", projects: [], projectOrder: [] } as never);
  useAccountStore.getState().createProject({ id: "task-apply" });
  const project = useAccountStore.getState().account.projects[0];
  const baseHash = await draftFingerprint(project);
  const task = {
    status: "completed",
    events: [
      { type: "accepted", baseHash },
      { type: "translations_written", entries: { test: { en: "AI" } } },
    ],
  } as AssistantTask;
  expect(project.i18nKeys).not.toHaveProperty("test");
  await applyTaskProposals(task, project.id);
  expect(useAccountStore.getState().account.projects[0].i18nKeys.test).toEqual({ en: "AI" });
});
it("refuses to overwrite a draft that changed while background work was running", async () => {
  useAccountStore.getState().setAccount({ id: "a", projects: [], projectOrder: [] } as never);
  useAccountStore.getState().createProject({ id: "task-test" });
  const project = useAccountStore.getState().account.projects[0];
  const baseHash = await draftFingerprint(project);
  const task = {
    events: [
      { type: "accepted", baseHash },
      { type: "translations_written", entries: { test: { en: "AI" } } },
    ],
  } as AssistantTask;
  useAccountStore
    .getState()
    .applyAssistantTranslations({ projectId: project.id, entries: { manual: { en: "Keep me" } } });
  await expect(applyTaskProposals(task, project.id)).rejects.toThrow("task_draft_conflict");
  expect(useAccountStore.getState().account.projects[0].i18nKeys).toHaveProperty("manual");
  expect(useAccountStore.getState().account.projects[0].i18nKeys).not.toHaveProperty("test");
});
