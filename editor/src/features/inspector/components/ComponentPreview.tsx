import { imageButtonRect } from "@/domain/imageButton";
import type { Menu, Project, ProjectId } from "@/domain/types";
import { ImageButtonsRender } from "@/features/canvas/ImageButtonsRender";
import { TEX_SCALE, TEX_SLOT_STRIDE, slotXY } from "@/features/canvas/menuLayout";
import { TitleRender } from "@/features/canvas/title/composer/TitleRender";
import { parsePositions } from "@/lib/positions";
import { useMemo } from "react";
import { Layer, Stage } from "react-konva";

/** The id of the menu a component is shown in: no menu of a Project has it. */
const PREVIEW = "__component_preview" as Menu["id"];

/** The room left around the component's slots, for a piece that reaches past them. */
const MARGIN = TEX_SLOT_STRIDE;

/**
 * A component as a menu draws it, alone: one button that names it on the slots `positions`,
 * drawn by the canvas's own renderers, with no menu behind. `slots` lines its slots in green
 * over it, as the atelier does over an image.
 */
export function ComponentPreview({
  project,
  component,
  positions,
  rows,
  slots = true,
}: {
  project: Project;
  component: NonNullable<Menu["layers"][number]["elements"][number]["display"]["component"]>;
  positions: string;
  rows: number;
  /** Whether the slots the component covers are lined over it. */
  slots?: boolean;
}) {
  const { menu, shown } = useMemo(() => {
    const menu = {
      id: PREVIEW,
      projectId: project.id,
      rows,
      title: [],
      layers: [
        {
          id: "preview",
          name: "preview",
          elements: [{ id: "preview", positions, display: { component }, states: [] }],
        },
      ],
    } as unknown as Menu;
    return { menu, shown: { ...project, documents: { ...project.documents, menu: [menu] } } };
  }, [project, component, positions, rows]);
  const covered = imageButtonRect(positions, "chest", rows);
  const first = parsePositions(positions);
  const origin = slotXY(first.length ? Math.min(...first) : 0, "chest", rows);
  const columns = covered?.width ?? 1;
  const lines = covered?.height ?? 1;
  const width = columns * TEX_SLOT_STRIDE;
  const height = lines * TEX_SLOT_STRIDE;
  return (
    <div data-testid="component-preview" className="relative">
      <Stage
        width={width + 2 * MARGIN}
        height={height + 2 * MARGIN}
        x={MARGIN - origin.x}
        y={MARGIN - origin.y}
        listening={false}
      >
        <Layer>
          <ImageButtonsRender
            projectId={project.id as ProjectId}
            menu={menu}
            frame={{ position: { x: 0, y: 0 }, layout: {} }}
          />
          <TitleRender
            projectId={project.id as ProjectId}
            menuId={menu.id}
            scale={TEX_SCALE}
            project={shown as Project}
            pass="interactive"
          />
        </Layer>
      </Stage>
      {slots ? (
        <div
          aria-hidden
          data-testid="component-slots"
          className="pointer-events-none absolute grid"
          style={{
            left: MARGIN,
            top: MARGIN,
            width,
            height,
            gridTemplateColumns: `repeat(${columns}, 1fr)`,
          }}
        >
          {Array.from({ length: columns * lines }, (_, slot) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: slots have no identity but their place
              key={slot}
              className="outline outline-1 -outline-offset-[0.5px] outline-[var(--brand)]"
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
