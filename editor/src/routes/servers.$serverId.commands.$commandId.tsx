import { Button } from "@/components/ui/button";
import { EditorHeader } from "@/components/ui/editor-header";
import { EmptyState } from "@/components/ui/empty-state";
import { createProject } from "@/lib/api/servers";
import { allCommands, commandNamespace } from "@/lib/commandOverride";
import { homeFolder } from "@/lib/moduleCommands";
import { projectDestination } from "@/lib/projectNavigation";
import { useSystemCommandsStore } from "@/state/systemCommandsStore";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/servers/$serverId/commands/$commandId")({
  component: CommandRoute,
});

/**
 * A module command's link (sidebar, server board): a command is edited in its module's
 * folder, like its Documents, and deployed with it. The page opens that folder on the
 * command; a module without a folder on this server gets one first.
 */
function CommandRoute() {
  const { serverId, commandId } = Route.useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const status = useSystemCommandsStore((s) => s.status);
  const commands = useSystemCommandsStore((s) => s.commands);
  const overrides = useSystemCommandsStore((s) => s.overrides);
  const folders = useSystemCommandsStore((s) => s.folders);
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);
  const command = allCommands(commands).find((c) => c.id === commandId);
  // The folder whose board shows it, as `moduleCommandEntriesOf` places it: a sub-command
  // without an override of its own follows its root.
  const root = commands.find((c) => allCommands([c]).some((n) => n.id === commandId));
  const folder =
    command && root
      ? homeFolder(command, overrides, folders, homeFolder(root, overrides, folders, null))
      : null;

  useEffect(() => {
    void useSystemCommandsStore.getState().load(serverId);
  }, [serverId]);

  useEffect(() => {
    if (!folder) return;
    void navigate({
      ...projectDestination(folder, serverId),
      search: { doc: commandId },
      replace: true,
    } as never);
  }, [folder, serverId, commandId, navigate]);

  if (!command) {
    return (
      <EmptyState
        icon={Terminal}
        title={t(status === "ready" ? "systemCommands.notFound" : "systemCommands.loading")}
      />
    );
  }
  if (folder) return <EmptyState icon={Terminal} title={t("systemCommands.opening")} />;

  const namespace = commandNamespace(command.id);
  const create = async () => {
    setCreating(true);
    setFailed(false);
    try {
      await createProject(serverId, namespace);
      // Its folder listed, the command finds it and the page opens it.
      await useSystemCommandsStore.getState().load(serverId, true);
    } catch {
      setFailed(true);
    } finally {
      setCreating(false);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3 md:p-4">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
        <div className="panel overflow-hidden rounded-[var(--r-md)]">
          <EditorHeader
            kind="command"
            eyebrow={t("systemCommands.eyebrow", { module: command.moduleId ?? namespace })}
            title={`/${command.name}`}
          >
            <span className="min-w-0 max-w-full truncate font-mono text-[12.5px] text-[var(--text-faint)]">
              {command.id}
            </span>
          </EditorHeader>
        </div>
        <p className="text-[13px] text-[var(--text-mut)]">
          {t("systemCommands.noFolder", { folder: namespace })}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={creating} onClick={() => void create()}>
            {t("systemCommands.createFolder", { folder: namespace })}
          </Button>
          {failed && (
            <span className="text-[12.5px] text-[var(--danger)]">
              {t("systemCommands.createFolderFailed")}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
