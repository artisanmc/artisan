import { Button } from "@/components/ui/button";
import { EditorHeader } from "@/components/ui/editor-header";
import { Input } from "@/components/ui/input";
import { DEFAULT_GROUP_COLOR } from "@/domain/canvasGroups";
import { allDocuments } from "@/domain/documents";
import { folderName, isWithin, parentFolder, slugifyFolderName } from "@/domain/folders";
import type { Project } from "@/domain/types";
import { FolderOperationError } from "@/state/projects/foldersSlice";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { Folder } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

/**
 * A themed folder in the Properties panel (selected through its frame on the board):
 * its name, its frame's colour, and what can be done with it.
 */
export function FolderProperties({ project, path }: { project: Project; path: string }) {
  const { t } = useTranslation();
  const store = useProjectsStore.getState();
  const color = project.folders?.[path]?.color ?? DEFAULT_GROUP_COLOR;
  const [name, setName] = useState(folderName(path));
  useEffect(() => setName(folderName(path)), [path]);
  const count = allDocuments(project).filter(
    ({ doc }) => doc.folder && isWithin(doc.folder, path),
  ).length;

  // Renaming moves the folder's files: done once, when the field is left.
  const rename = () => {
    if (!name || name === folderName(path)) return setName(folderName(path));
    try {
      const renamed = store.renameFolder({ projectId: project.id, path, name });
      useSelectionStore.getState().selectFolder(renamed);
    } catch (e) {
      setName(folderName(path));
      toast.error(e instanceof FolderOperationError ? t(`folders.errors.${e.code}`) : String(e));
    }
  };

  return (
    <div className="flex flex-col">
      <EditorHeader
        appearance={{
          icon: Folder,
          fg: color,
          soft: `color-mix(in srgb, ${color} 16%, transparent)`,
          line: `color-mix(in srgb, ${color} 45%, transparent)`,
        }}
        eyebrow={t("folders.properties.kind")}
        title={folderName(path)}
        meta={
          <span className="text-[12.5px] text-[var(--text-faint)]">
            {t("folders.properties.count", { count })}
          </span>
        }
      />
      <div className="flex flex-col gap-4 p-3">
        <div>
          <label className="field-label" htmlFor="folder-name">
            {t("folders.name")}
          </label>
          <Input
            id="folder-name"
            value={name}
            maxLength={64}
            onChange={(e) => setName(slugifyFolderName(e.target.value))}
            onBlur={rename}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
          />
          <p className="mt-1 text-[11.5px] text-[var(--text-faint)]">{t("folders.nameHint")}</p>
        </div>
        {/* Only a top-level folder has a frame, so a colour. */}
        {!parentFolder(path) && (
          <div>
            <label className="field-label" htmlFor="folder-color">
              {t("canvas.groups.color")}
            </label>
            <Input
              id="folder-color"
              type="color"
              value={color}
              onChange={(e) =>
                store.setFolderColor({ projectId: project.id, path, color: e.target.value })
              }
              className="h-10 w-20 cursor-pointer"
            />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => useUiStore.getState().setBoardFolder(project.id, path)}
          >
            {t("folders.showOnly")}
          </Button>
          {!parentFolder(path) && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => store.rearrangeCanvasGroup({ projectId: project.id, groupId: path })}
            >
              {t("canvas.groups.rearrange")}
            </Button>
          )}
          <Button
            size="sm"
            variant="secondary"
            title={t("folders.deleteHint")}
            onClick={() => {
              store.deleteFolder({ projectId: project.id, path });
              useSelectionStore.getState().clear();
            }}
          >
            {t("folders.delete")}
          </Button>
        </div>
      </div>
    </div>
  );
}
