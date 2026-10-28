import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ClickHandler, ClickType, ElementId, MenuId, ProjectId } from "@/domain/types";
import { type AppearanceTarget, useProjectsStore } from "@/state/projectsStore";
import { useTranslation } from "react-i18next";
import { ActionChainEditor } from "./StepTree";
import { CLICK_TYPE_ORDER, clickTypeLabel } from "./labels";

interface ElementClickHandlersProps {
  projectId: ProjectId;
  /** Menu context — placeholders and action defaults resolve against it. */
  menuId: MenuId;
  elementId: ElementId;
  stateIndex: number;
  click: { [k in ClickType]?: ClickHandler } | undefined;
}

const targetOf = (menuId: MenuId, elementId: ElementId): AppearanceTarget => ({
  menuId,
  elementId,
});

/** The click handlers of one Element state: one Action chain per click type, add / remove. */
export function ElementClickHandlers({
  projectId,
  menuId,
  elementId,
  stateIndex,
  click,
}: ElementClickHandlersProps) {
  const { t } = useTranslation();
  const populated = CLICK_TYPE_ORDER.filter((ct) => click?.[ct]);
  const unpopulated = CLICK_TYPE_ORDER.filter((ct) => !click?.[ct]);
  const addHandler = useProjectsStore((s) => s.addElementClickHandler);
  const removeHandler = useProjectsStore((s) => s.removeElementClickHandler);
  const target = targetOf(menuId, elementId);

  return (
    <div className="flex flex-col gap-2">
      {populated.map((clickType) => (
        <div
          key={clickType}
          className="rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] font-mono text-[12px]"
        >
          <div className="flex items-center justify-between border-[var(--border-soft)] border-b px-2 py-1">
            <span className="text-[11px] text-[var(--brand)]">
              {t("flow.clickHandlerOn", { clickType })}
            </span>
            <button
              type="button"
              title={t("flow.clickRemove")}
              onClick={() =>
                removeHandler({ projectId, ...target, appearanceIndex: stateIndex, clickType })
              }
              className="flex h-6 w-6 items-center justify-center rounded text-[13px] text-[var(--text-faint)] leading-none hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            >
              ×
            </button>
          </div>
          <div className="p-1.5">
            <ActionChainEditor
              projectId={projectId}
              address={{ kind: "element", menuId, elementId, stateIndex, clickType }}
              steps={click![clickType]!.steps}
            />
          </div>
        </div>
      ))}
      {unpopulated.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="self-start rounded border border-[var(--border)] border-dashed px-2 py-1.5 text-[11px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
            >
              {t("flow.clickAdd")}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)]"
          >
            {unpopulated.map((opt) => (
              <DropdownMenuItem
                key={opt}
                onSelect={() =>
                  addHandler({
                    projectId,
                    ...target,
                    appearanceIndex: stateIndex,
                    clickType: opt,
                  })
                }
                className="cursor-pointer font-mono text-[11px] focus:bg-[var(--surface-hover)]"
              >
                {clickTypeLabel(opt)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
