import "./styles.css";
import "@/i18n";
import { Button } from "@/components/ui/button";
import { projectId } from "@/domain/ids";
import { MigrationPanel } from "@/features/assistant/MigrationPanel";
import { TaskTimeline } from "@/features/assistant/TaskTimeline";
import { applyTaskProposals } from "@/features/assistant/taskProposals";
import { useDraftSync } from "@/features/project/useDraftSync";
import { projectFromFiles } from "@/schema/projectFromFiles";
import { useAccountStore } from "@/state/accountStore";
import { useProjectBaselineStore } from "@/state/projectBaselineStore";
import { useProjectDraftStore } from "@/state/projectDraftStore";
import { createRoot } from "react-dom/client";

useAccountStore.getState().setAccount({ id: "fixture", projects: [], projectOrder: [] } as never);
useAccountStore.getState().createProject({ id: "p" });
useProjectBaselineStore.getState().set("p", {});
const draft = useProjectDraftStore.getState().get("p");
if (draft) {
  const account = useAccountStore.getState().account;
  const files = Object.fromEntries(
    Object.entries(draft.tree).map(([path, text]) => [`plugins/Artisan/projects/p/${path}`, text]),
  );
  useAccountStore.getState().setAccount({
    ...account,
    projects: [projectFromFiles(projectId("p"), files)],
  });
}
const groups = [
  {
    sourceId: "zmenu",
    label: "zMenu menus",
    files: Array.from({ length: 35 }, (_, i) => ({
      path: `menus/m${i}.yml`,
      size: 120,
    })),
  },
];
function Fixture() {
  useDraftSync();
  const project = useAccountStore((s) => s.account.projects[0]);
  if (new URLSearchParams(location.search).has("tasks"))
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="mb-6 text-xl font-semibold">Assistant</h1>
        <TaskTimeline
          conversationId="c"
          refresh={0}
          onBusy={() => {}}
          onTranscriptOffset={() => {}}
          onApply={(task) => applyTaskProposals(task, projectId("p"))}
        />
      </main>
    );
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-xl font-semibold">Migrate connected zMenu menus</h1>
      <p className="my-2 text-sm">
        Isolated verification fixture — 35 selected files, simulated service.
      </p>
      <output data-testid="menu-count">{project?.menus.length ?? 0} menus in draft</output>
      <MigrationPanel
        projectId="p"
        conversationId="c"
        ensureConversation={async () => "c"}
        modelId="model"
        groups={groups}
        disabled={false}
      />
      <Button
        variant="secondary"
        onClick={() => {
          const account = structuredClone(useAccountStore.getState().account);
          const menu = account.projects[0]?.menus.find((m) => m.id === "m0");
          if (menu) menu.notes = "LOCAL EDIT MUST SURVIVE";
          useAccountStore.getState().setAccount(account);
        }}
      >
        Edit first menu locally
      </Button>
      <output data-testid="local-edit">{project?.menus.find((m) => m.id === "m0")?.notes}</output>
    </main>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<Fixture />);
