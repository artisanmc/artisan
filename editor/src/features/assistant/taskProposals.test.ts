import { expect, it } from "vitest";
import { useAccountStore } from "@/state/accountStore";
import { applyTaskProposals, draftFingerprint } from "./taskProposals";
import type { AssistantTask } from "@/lib/api/assistantTasks";
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
