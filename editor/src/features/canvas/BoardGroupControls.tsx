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
import { DEFAULT_GROUP_COLOR } from "@/domain/canvasGroups";
import type { Project } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

export type GroupDialogState = { menuIds: string[] } | { groupId: string } | null;

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
  const menus = project.menus.filter((m) => selected.has(m.id)).map((m) => m.id as string);
  const canGroup = selectionScope === null && menus.length >= 2 && menus.length === selected.size;
  const editing =
    dialog && "groupId" in dialog
      ? project.canvasGroups?.find((g) => g.id === dialog.groupId)
      : undefined;
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_GROUP_COLOR);
  useEffect(() => {
    setName(dialog ? (editing?.name ?? "") : "");
    setColor(editing?.color ?? DEFAULT_GROUP_COLOR);
  }, [dialog, editing?.name, editing?.color]);
  const store = useAccountStore.getState();
  const close = () => onDialogChange(null);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !dialog) return;
    try {
      if ("menuIds" in dialog)
        store.createCanvasGroup({ projectId: project.id, name, menuIds: dialog.menuIds, color });
      else store.updateCanvasGroup({ projectId: project.id, groupId: dialog.groupId, name, color });
      close();
    } catch {
      toast.error(t("canvas.groups.invalidSelection"));
    }
  };
  return (
    <>
      <div className="absolute left-3 top-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap gap-2">
        {canGroup && (
          <Button size="sm" onClick={() => onDialogChange({ menuIds: menus })}>
            {t("canvas.groups.createSelection")}
          </Button>
        )}
        {(project.canvasGroups?.length ?? 0) > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary">
                {t("canvas.groups.title")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {(project.canvasGroups ?? []).map((group) => (
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
                      onSelect={() =>
                        store.dissolveCanvasGroup({ projectId: project.id, groupId: group.id })
                      }
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
            <DialogDescription>{t("canvas.groups.description")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <label className="field-label" htmlFor="canvas-group-name">
              {t("canvas.groups.name")}
            </label>
            <Input
              id="canvas-group-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
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
              <Button type="submit" disabled={!name.trim()}>
                {t(editing ? "canvas.groups.save" : "canvas.groups.create")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
