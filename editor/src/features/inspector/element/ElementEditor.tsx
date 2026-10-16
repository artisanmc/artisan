import { Input } from "@/components/ui/input";
import { assetPreviewUrl } from "@/domain/asset";
import { resolveDisplayRef } from "@/domain/capturedItems";
import { addressedAppearances } from "@/domain/element";
import { getFirstTitleText } from "@/domain/menuTitle";
import type { Element, ElementId, Menu, MenuId, ProjectId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { useTextureUrl } from "@/features/canvas/textureStore";
import { useHeadPreviewUrl } from "@/features/canvas/useHeadPreviewUrl";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { formatPositions, parsePositions } from "@/lib/positions";
import { useGetText } from "@/lib/useText";
import { useFlowSelectionStore } from "@/state/flowSelectionStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useSelectionStore } from "@/state/selectionStore";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { FieldLabel, Lane } from "../layout";
import { SortableStates } from "./StateCards";

export function ElementEditor({
  projectId,
  menu,
  element,
}: {
  projectId: ProjectId;
  menu: Menu;
  element: Element;
}) {
  const sub = useFlowSelectionStore((s) => s.sub);
  const setSub = useFlowSelectionStore((s) => s.set);
  const focusedStateIndex =
    sub && (sub.kind === "state" || sub.kind === "step") ? (sub.stateIndex ?? 0) : 0;

  const headerProject = useProjectsStore((s) =>
    s.openProjects.projects.find((p) => p.id === projectId),
  );
  const appearances = addressedAppearances(element);
  const focusedState = appearances[focusedStateIndex] ?? appearances[0];
  const headerMaterial = focusedState?.material ?? "";
  // Captured-item refs (`item:<id>`) expand to their display descriptor.
  const headerDisplay = headerProject
    ? resolveDisplayRef(headerProject, headerMaterial)
    : { material: headerMaterial };
  const headerMaterialUrl = useTextureUrl(headerDisplay.material);
  const headerItemUrl =
    useHeadPreviewUrl(focusedState?.head ?? headerDisplay.head) ?? headerMaterialUrl;
  const headerImage = useAssetStore((s) =>
    s.assets.find((a) => a.projectId === projectId && a.id === focusedState?.image?.asset),
  );
  const headerTextureUrl = headerImage ? assetPreviewUrl(headerImage) : headerItemUrl;
  const getText = useGetText(projectId);
  const headerTitle = getText(focusedState?.title);
  const menuTitle = getText(getFirstTitleText(menu));
  const { t } = useTranslation();

  const addAppearance = useProjectsStore((s) => s.addAppearance);
  const duplicateAppearance = useProjectsStore((s) => s.duplicateAppearance);
  const deleteElement = useProjectsStore((s) => s.deleteElement);

  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      {/* Element identity strip — preview of the focused state. */}
      <div className="flex items-center gap-3 border-[var(--border-soft)] border-b bg-[var(--surface-raised)] px-3 py-2">
        <div className="flex h-8 w-8 items-center justify-center rounded border border-[var(--border-soft)] bg-[var(--surface)]">
          {headerTextureUrl ? (
            <img
              src={headerTextureUrl}
              alt={headerMaterial}
              draggable={false}
              className="h-3/4 w-3/4 object-contain"
              style={{ imageRendering: "pixelated" }}
            />
          ) : (
            <span className="text-[8px] text-[var(--text-faint)]">
              {headerMaterial.slice(0, 4)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {/* Item + menu names are MiniMessage: render the styling instead of
              printing the raw tags. */}
          <MiniMessageInline
            source={headerTitle || headerMaterial}
            className="block truncate font-mono text-xs text-[var(--text)]"
          />
          <div className="truncate text-[10px] text-[var(--text-faint)]">
            <MiniMessageInline source={menuTitle} /> ·{" "}
            {t(appearances.length === 1 ? "flow.headerStateOne" : "flow.headerStateOther", {
              count: appearances.length,
            })}
          </div>
        </div>
        {/* Always-available delete — works even for elements the canvas can't
            target (e.g. a placement element whose placements were all removed). */}
        <button
          type="button"
          data-testid="delete-element"
          title={t("flow.deleteElement")}
          onClick={() => {
            deleteElement({ projectId, menuId: menu.id, elementId: element.id });
            useSelectionStore.getState().clear();
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[14px] text-[var(--text-faint)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
        >
          🗑
        </button>
      </div>

      <div className="flex-1 overflow-auto px-3 py-3">
        <ElementIdField projectId={projectId} menuId={menu.id} elementId={element.id} />
        {/* Positions are meaningless in placement mode (each row carries its own
            slot), and iteration is the mutually-exclusive sibling. */}
        {!element.places ? (
          <PositionsField projectId={projectId} menuId={menu.id} element={element} />
        ) : null}
        {/* Iteration is managed at the MENU level (data section — item set);
            the element only shows its binding as context for the states. */}
        {element.iterates ? (
          <div className="mb-3 rounded border border-[var(--brand-line)] border-dashed bg-[var(--brand-soft)] px-2.5 py-1.5 text-[11px] text-[var(--brand)]">
            {t("flow.iterateBound", {
              source: element.iterates.source,
              alias: element.iterates.alias || "item",
            })}
            <span className="ml-1 text-[10px] opacity-75">
              {t("flow.iterationManagedHint", {
                example: `{${element.iterates.alias || "item"}.champ}`,
              })}
            </span>
          </div>
        ) : null}

        <Lane label={t("flow.states")}>
          <SortableStates
            projectId={projectId}
            menu={menu}
            element={element}
            appearances={appearances}
            focusedStateIndex={focusedStateIndex}
            onAdd={() => {
              addAppearance({ projectId, menuId: menu.id, elementId: element.id });
              setSub({ kind: "state", stateIndex: appearances.length });
            }}
            onDuplicate={() => {
              duplicateAppearance({
                projectId,
                menuId: menu.id,
                elementId: element.id,
                appearanceIndex: focusedStateIndex,
              });
              setSub({ kind: "state", stateIndex: appearances.length });
            }}
          />
        </Lane>
      </div>
    </div>
  );
}

function ElementIdField({
  projectId,
  menuId,
  elementId,
}: {
  projectId: ProjectId;
  menuId: MenuId;
  elementId: ElementId;
}) {
  const { t } = useTranslation();
  const setElementId = useProjectsStore((s) => s.setElementId);
  const [draft, setDraft] = useState(elementId as string);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(elementId);
    setError(null);
  }, [elementId]);

  const commit = () => {
    if (draft === elementId) return;
    try {
      setElementId({ projectId, menuId, oldId: elementId, newId: draft as ElementId });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("menuProperties.renameRejected"));
      setDraft(elementId);
    }
  };

  return (
    <div className="mb-3">
      <FieldLabel>{t("flow.elementId")}</FieldLabel>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(elementId);
            setError(null);
            e.currentTarget.blur();
          }
        }}
        className={
          error
            ? "h-8 border-[var(--danger)] px-2 py-0 font-mono text-xs"
            : "h-8 px-2 py-0 font-mono text-xs"
        }
      />
      {error ? <div className="mt-1 text-[10px] text-[var(--danger)]">{error}</div> : null}
    </div>
  );
}

function PositionsField({
  projectId,
  menuId,
  element,
}: {
  projectId: ProjectId;
  menuId: MenuId;
  element: Element;
}) {
  const { t } = useTranslation();
  const setElementPositions = useProjectsStore((s) => s.setElementPositions);
  const [draft, setDraft] = useState(element.positions);
  // biome-ignore lint/correctness/useExhaustiveDependencies: element.id forces draft reset on element switch
  useEffect(() => {
    setDraft(element.positions);
  }, [element.id, element.positions]);
  const commit = () => {
    const canonical = formatPositions(parsePositions(draft));
    if (canonical !== element.positions) {
      setElementPositions({ projectId, menuId, elementId: element.id, positions: canonical });
    }
    setDraft(canonical);
  };
  const positionsCount = parsePositions(element.positions).length;
  return (
    <div className="mb-3">
      <FieldLabel>
        {t(positionsCount === 1 ? "flow.positionsLabelOne" : "flow.positionsLabelOther", {
          count: positionsCount,
        })}
      </FieldLabel>
      <Input
        value={draft}
        placeholder="0-8,17,26"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.blur();
          }
        }}
        className="h-8 px-2 py-0 font-mono text-xs"
      />
    </div>
  );
}
