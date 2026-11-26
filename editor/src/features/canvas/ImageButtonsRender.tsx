import { assetPreviewUrl } from "@/domain/asset";
import { menusOf } from "@/domain/documents";
import {
  appearanceImages,
  hasImageButton,
  imageButtonGeometry,
  imageButtonOrigin,
  imageButtonRect,
} from "@/domain/imageButton";
import type { Element, Menu, MenuId, ProjectId } from "@/domain/types";
import { useImageAsset } from "@/features/assets/kitAssets";
import { slicedCanvas } from "@/features/assets/slicedUrl";
import { useCssVar } from "@/lib/themeColors";
import { useAuthenticatedImage } from "@/lib/useAuthenticatedImage";
import { useHoverStore } from "@/state/hoverStore";
import { useImageButtonDragStore } from "@/state/imageButtonDragStore";
import { useProjectsStore } from "@/state/projectsStore";
import { isElementSelected, useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { useMemo, useRef } from "react";
import { Group, Image, Rect, Text } from "react-konva";
import { toast } from "sonner";
import type { ImageButtonImage } from "../../../../docs/schema/menu/v1/imageButtonGeometry";
import { hitTestSlot } from "./hitTest";
import { TEX_SCALE, TEX_SLOT_STRIDE } from "./menuLayout";

/**
 * Where the menu sits on the project canvas and where every menu sits, to read which
 * slot of which menu a button is released over.
 */
export interface ImageButtonDropFrame {
  position: { x: number; y: number };
  layout: Record<string, { x: number; y: number }>;
}

export function ImageButtonsRender({
  projectId,
  menu,
  frame,
  onDeepSelect,
}: {
  projectId: ProjectId;
  menu: Menu;
  frame: ImageButtonDropFrame;
  onDeepSelect?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
}) {
  return (
    <>
      {menu.layers
        .flatMap((layer) => layer.elements)
        .filter((el) => appearanceImages(el.display).length > 0)
        .map((element) => (
          <ImageButtonRender
            key={element.id}
            projectId={projectId}
            menu={menu}
            element={element}
            frame={frame}
            onDeepSelect={onDeepSelect}
          />
        ))}
    </>
  );
}

function ImageButtonRender({
  projectId,
  menu,
  element,
  frame,
  onDeepSelect,
}: {
  projectId: ProjectId;
  menu: Menu;
  element: Element;
  frame: ImageButtonDropFrame;
  onDeepSelect?: (e: Konva.KonvaEventObject<MouseEvent>) => void;
}) {
  const images = appearanceImages(element.display);
  const ids = useSelectionStore((state) => state.ids);
  const selectedMenu = useSelectionStore((state) => state.menuId);
  const brand = useCssVar("--brand");
  // The point of the button held by the pointer, in the button's own pixels.
  const grabRef = useRef<{ x: number; y: number } | null>(null);
  const rect = imageButtonRect(
    element.positions,
    menu.inventoryType ?? "chest",
    menu.rows,
    menu.playerInventory,
  );
  if (!rect || !hasImageButton(element)) return null;
  const x = rect.x * TEX_SCALE;
  const y = rect.y * TEX_SCALE;
  const width = rect.width * 18 * TEX_SCALE;
  const height = rect.height * 18 * TEX_SCALE;
  const selected = isElementSelected(ids, selectedMenu, element.id, menu.id);
  const select = () => {
    useUiStore.getState().setSelectedLayerKey(null);
    useSelectionStore.getState().set([element.id], null, menu.id);
  };
  return (
    <Group
      x={x}
      y={y}
      draggable
      name={`image-button:${menu.id}:${element.id}`}
      onClick={(event) => {
        event.cancelBubble = true;
        if (onDeepSelect && (event.evt.ctrlKey || event.evt.metaKey)) onDeepSelect(event);
        else if (event.evt.shiftKey || event.evt.ctrlKey || event.evt.metaKey)
          useSelectionStore.getState().toggleElement(element.id, menu.id);
        else select();
      }}
      onTap={(event) => {
        event.cancelBubble = true;
        select();
      }}
      onMouseDown={(event) => {
        grabRef.current = event.currentTarget.getRelativePointerPosition() ?? null;
      }}
      onTouchStart={(event) => {
        grabRef.current = event.currentTarget.getRelativePointerPosition() ?? null;
      }}
      onDragStart={(event) => {
        event.cancelBubble = true;
        // Its menu above the other menus, so the button stays visible on its way to one of
        // them. The button itself keeps its place in the menu: the labels, drawn after it,
        // stay above it (raised, it would hide its own label until the menu redraws).
        event.target.getParent()?.moveToTop();
        select();
      }}
      onDragMove={(event) => {
        // What is drawn apart from this node (the label, in the title) follows the button.
        useImageButtonDragStore.getState().setDrag({
          menuId: menu.id,
          elementId: element.id,
          dx: event.target.x() - x,
          dy: event.target.y() - y,
        });
      }}
      onDragEnd={(event) => {
        event.cancelBubble = true;
        useImageButtonDragStore.getState().setDrag(null);
        const node = event.target;
        const grab = grabRef.current ?? { x: width / 2, y: height / 2 };
        grabRef.current = null;
        // The slot under the pointer receives the cell of the button it holds.
        const pointerX = node.x() + grab.x;
        const pointerY = node.y() + grab.y;
        node.position({ x, y });
        const cell = {
          col: clamp(Math.floor(grab.x / TEX_SLOT_STRIDE), rect.width),
          row: clamp(Math.floor(grab.y / TEX_SLOT_STRIDE), rect.height),
        };
        const project = useProjectsStore
          .getState()
          .openProjects.projects.find((entry) => entry.id === projectId);
        if (!project) return;
        const hit = hitTestSlot(
          project,
          frame.layout,
          frame.position.x + pointerX,
          frame.position.y + pointerY,
        );
        if (!hit) return;
        const toMenuId = hit.menuId as MenuId;
        const target = menusOf(project).find((entry) => entry.id === toMenuId);
        if (!target) return;
        const origin = imageButtonOrigin(target, hit.position, cell);
        try {
          if (origin === null) throw new Error("The image button must fit inside the menu.");
          const id = useProjectsStore.getState().moveImageButton({
            projectId,
            menuId: menu.id,
            elementId: element.id,
            toMenuId,
            position: origin,
          });
          if (id && toMenuId !== menu.id) useSelectionStore.getState().set([id], null, toMenuId);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error));
        }
      }}
      onMouseEnter={() => useHoverStore.getState().setElement(element.id, rect.slot, menu.id)}
      onMouseLeave={() => useHoverStore.getState().setElement(null, null)}
    >
      <Rect width={width} height={height} fill="rgba(0,0,0,0.001)" />
      <Group clipX={0} clipY={0} clipWidth={width} clipHeight={height} listening={false}>
        {images.map((image, index) => (
          <ButtonImage
            // biome-ignore lint/suspicious/noArrayIndexKey: the pieces of a look have no id, their order is their identity
            key={index}
            projectId={projectId}
            image={image}
            columns={rect.width}
            rows={rect.height}
            named={index === 0}
          />
        ))}
      </Group>
      {selected && (
        <Rect width={width} height={height} stroke={brand} strokeWidth={2} listening={false} />
      )}
    </Group>
  );
}

/**
 * One image of a look in its element's rectangle (`columns` × `rows` slots), as the pack draws
 * it: a sliced image fills the rectangle (`slice.ts`), another sits at its anchor. `named`: its
 * name is written while its picture is missing.
 */
function ButtonImage({
  projectId,
  image: spec,
  columns,
  rows,
  named,
}: {
  projectId: ProjectId;
  image: ImageButtonImage;
  columns: number;
  rows: number;
  named: boolean;
}) {
  const asset = useImageAsset(projectId, spec.asset);
  const [image] = useAuthenticatedImage(asset ? assetPreviewUrl(asset) : "");
  const brand = useCssVar("--brand");
  const sliced = useMemo(
    () =>
      image && asset?.slice ? slicedCanvas(image, asset.slice, columns * 18, rows * 18) : null,
    [image, asset?.slice, columns, rows],
  );
  const picture = sliced ?? image;
  if (!picture)
    return named ? (
      <Text
        text={asset?.name ?? spec.asset ?? "Image"}
        width={columns * 18 * TEX_SCALE}
        height={rows * 18 * TEX_SCALE}
        align="center"
        verticalAlign="middle"
        fill={brand}
        listening={false}
      />
    ) : null;
  const draw = imageButtonGeometry(
    sliced ? { ...spec, fit: "native" } : spec,
    picture.width,
    picture.height,
    columns * 18,
    rows * 18,
  );
  return (
    <Image
      image={picture}
      imageSmoothingEnabled={false}
      x={draw.x * TEX_SCALE}
      y={draw.y * TEX_SCALE}
      width={draw.width * TEX_SCALE}
      height={draw.height * TEX_SCALE}
      listening={false}
    />
  );
}

const clamp = (index: number, size: number) => Math.min(Math.max(index, 0), size - 1);
