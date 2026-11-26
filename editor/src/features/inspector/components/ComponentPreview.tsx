import type { Menu, Project, ProjectId } from "@/domain/types";
import { ImageButtonsRender } from "@/features/canvas/ImageButtonsRender";
import { MenuBackground } from "@/features/canvas/MenuBackground";
import { TEX_SCALE, menuBoxSize } from "@/features/canvas/menuLayout";
import { TitleRender } from "@/features/canvas/title/composer/TitleRender";
import { useMemo } from "react";
import { Layer, Stage } from "react-konva";

/** The id of the menu a component is shown in: no menu of a Project has it. */
const PREVIEW = "__component_preview" as Menu["id"];

/**
 * A component as a menu draws it: one button that names it, on the slots `positions` of an
 * otherwise empty chest of `rows` rows, drawn by the canvas's own renderers.
 */
export function ComponentPreview({
  project,
  component,
  positions,
  rows,
}: {
  project: Project;
  component: NonNullable<Menu["layers"][number]["elements"][number]["display"]["component"]>;
  positions: string;
  rows: number;
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
  const box = menuBoxSize("chest", rows);
  return (
    <div data-testid="component-preview" className="overflow-auto">
      <Stage width={box.width} height={box.height} listening={false}>
        <Layer>
          <MenuBackground menu={menu} />
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
    </div>
  );
}
