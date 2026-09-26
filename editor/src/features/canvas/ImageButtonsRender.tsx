import { assetPreviewUrl } from "@/domain/asset";
import { hasImageButton, imageButtonGeometry, imageButtonRect } from "@/domain/imageButton";
import type { Element, Menu, ProjectId } from "@/domain/types";
import { useAssetStore } from "@/features/assets/assetStore";
import { useCssVar } from "@/lib/themeColors";
import { useAuthenticatedImage } from "@/lib/useAuthenticatedImage";
import { useAccountStore } from "@/state/accountStore";
import { useHoverStore } from "@/state/hoverStore";
import { isElementSelected, useSelectionStore } from "@/state/selectionStore";
import { Group, Image, Rect, Text } from "react-konva";
import { toast } from "sonner";
import { TEX_SCALE } from "./menuLayout";

export function ImageButtonsRender({ projectId, menu }: { projectId: ProjectId; menu: Menu }) {
  return (
    <>
      {menu.layers
        .flatMap((layer) => layer.elements)
        .filter((el) => !!el.display.image)
        .map((element) => (
          <ImageButtonRender key={element.id} projectId={projectId} menu={menu} element={element} />
        ))}
    </>
  );
}

function ImageButtonRender({
  projectId,
  menu,
  element,
}: { projectId: ProjectId; menu: Menu; element: Element }) {
  const appearance = element.display;
  const assets = useAssetStore((state) => state.assets);
  const asset = assets.find(
    (entry) => entry.id === appearance.image?.asset && entry.projectId === projectId,
  );
  const [image] = useAuthenticatedImage(asset ? assetPreviewUrl(asset) : "");
  const ids = useSelectionStore((state) => state.ids);
  const selectedMenu = useSelectionStore((state) => state.menuId);
  const brand = useCssVar("--brand");
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
  const draw = imageButtonGeometry(
    appearance.image!,
    image?.width ?? 1,
    image?.height ?? 1,
    width / TEX_SCALE,
    height / TEX_SCALE,
  );
  const select = () => useSelectionStore.getState().set([element.id], null, menu.id);
  return (
    <Group
      x={x}
      y={y}
      draggable
      name={`image-button:${menu.id}:${element.id}`}
      onClick={(event) => {
        event.cancelBubble = true;
        select();
      }}
      onTap={(event) => {
        event.cancelBubble = true;
        select();
      }}
      onDragStart={(event) => {
        event.cancelBubble = true;
        select();
      }}
      onDragEnd={(event) => {
        event.cancelBubble = true;
        const node = event.target;
        const dCol = Math.round((node.x() - x) / (18 * TEX_SCALE));
        const dRow = Math.round((node.y() - y) / (18 * TEX_SCALE));
        node.position({ x, y });
        try {
          useAccountStore.getState().moveSelectionByDelta({
            projectId,
            menuId: menu.id,
            elementIds: [element.id],
            dCol,
            dRow,
          });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : String(error));
        }
      }}
      onMouseEnter={() => useHoverStore.getState().setElement(element.id, rect.slot, menu.id)}
      onMouseLeave={() => useHoverStore.getState().setElement(null, null)}
    >
      <Rect width={width} height={height} fill="rgba(0,0,0,0.001)" />
      <Group clipX={0} clipY={0} clipWidth={width} clipHeight={height} listening={false}>
        {image ? (
          <Image
            image={image}
            x={draw.x * TEX_SCALE}
            y={draw.y * TEX_SCALE}
            width={draw.width * TEX_SCALE}
            height={draw.height * TEX_SCALE}
            listening={false}
          />
        ) : (
          <Text
            text={asset?.name ?? appearance.image?.asset ?? "Image"}
            width={width}
            height={height}
            align="center"
            verticalAlign="middle"
            fill={brand}
            listening={false}
          />
        )}
      </Group>
      {selected && (
        <Rect width={width} height={height} stroke={brand} strokeWidth={2} listening={false} />
      )}
    </Group>
  );
}
