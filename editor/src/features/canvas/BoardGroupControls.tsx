import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { DEFAULT_GROUP_COLOR, folderGroups, liveDocumentIds } from "@/domain/canvasGroups";
import { listFolders, slugifyFolderName } from "@/domain/folders";
import type { Project } from "@/domain/types";
import { FolderOperationError } from "@/state/projects/foldersSlice";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

/** File the selection in a folder (`nodeIds`), or edit a folder frame (`groupId`: its top-level folder). */
export type GroupDialogState = { nodeIds: string[] } | { groupId: string } | null;

export function BoardGroupControls({
  project,
  dialog,
  onDialogChange,
}: {
  project: Project;
  dialog: GroupDialogState;
  onDialogChange: (state: GroupDialogState) => void;
}) {
  const { t } = useTranslation();
  const selected = useSelectionStore((s) => s.ids);
  const selectionScope = useSelectionStore((s) => s.menuId);
  const live = new Set(liveDocumentIds(project));
  const nodes = [...selected].filter((id) => live.has(id));
  const canFile = selectionScope === null && nodes.length >= 1 && nodes.length === selected.size;
  const frames = folderGroups(project);
  const editing = dialog && "groupId" in dialog ? dialog.groupId : null;
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_GROUP_COLOR);
  useEffect(() => {
    setName(editing ?? "");
    setColor((editing && project.folders?.[editing]?.color) || DEFAULT_GROUP_COLOR);
  }, [editing, project.folders]);
  const store = useProjectsStore.getState();
  const close = () => onDialogChange(null);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name || !dialog) return;
    try {
      if ("nodeIds" in dialog) {
        if (!listFolders(project).includes(name))
          store.createFolder({ projectId: project.id, parent: "", name });
        store.setFolderColor({ projectId: project.id, path: name, color });
        store.moveToFolder({ projectId: project.id, nodeIds: dialog.nodeIds, folder: name });
      } else {
        const path = store.renameFolder({ projectId: project.id, path: dialog.groupId, name });
        store.setFolderColor({ projectId: project.id, path, color });
      }
      close();
    } catch (e) {
      toast.error(
        e instanceof FolderOperationError
          ? t(`folders.errors.${e.code}`)
          : t("canvas.groups.invalidSelection"),
      );
    }
  };
  return (
    <>
      <div className="absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-2">
        {canFile && (
          <Button size="sm" onClick={() => onDialogChange({ nodeIds: nodes })}>
            {t("canvas.groups.createSelection")}
          </Button>
        )}
        {frames.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary">
                {t("canvas.groups.title")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {frames.map((group) => (
                <DropdownMenuSub key={group.id}>
                  <DropdownMenuSubTrigger>{group.name}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem onSelect={() => onDialogChange({ groupId: group.id })}>
                      {t("canvas.groups.edit")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        store.rearrangeCanvasGroup({ projectId: project.id, groupId: group.id })
                      }
                    >
                      {t("canvas.groups.rearrange")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => store.deleteFolder({ projectId: project.id, path: group.id })}
                    >
                      {t("canvas.groups.dissolve")}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(editing ? "canvas.groups.edit" : "canvas.groups.create")}</DialogTitle>
            <DialogDescription>
              {t(editing ? "canvas.groups.editDescription" : "canvas.groups.description")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <label className="field-label" htmlFor="canvas-group-name">
              {t("canvas.groups.name")}
            </label>
            <Input
              id="canvas-group-name"
              autoFocus
              list={editing ? undefined : "canvas-group-folders"}
              value={name}
              onChange={(e) => setName(slugifyFolderName(e.target.value))}
              maxLength={64}
            />
            {!editing && (
              <datalist id="canvas-group-folders">
                {frames.map((g) => (
                  <option key={g.id} value={g.id} />
                ))}
              </datalist>
            )}
            <label className="field-label" htmlFor="canvas-group-color">
              {t("canvas.groups.color")}
            </label>
            <Input
              id="canvas-group-color"
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="h-10 w-20 cursor-pointer"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={close}>
                {t("canvas.groups.cancel")}
              </Button>
              <Button type="submit" disabled={!name}>
                {t(editing ? "canvas.groups.save" : "canvas.groups.create")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
