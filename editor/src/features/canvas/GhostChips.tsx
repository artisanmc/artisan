import type { Pack, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { elementLabel } from "@/features/workspace/usePackElements";
import type Konva from "konva";
import { useMemo } from "react";
import { Group, Rect, Text } from "react-konva";
import { deriveEdges } from "./deriveEdges";
import type { Box } from "./edgeRouting";
import { COMMAND_BOX, DIALOG_BOX, menuBoxSize } from "./menuLayout";
import { offBoardLinks } from "./offBoardLinks";

interface GhostChipsProps {
  pack: Pack;
  layout: Record<string, { x: number; y: number }>;
  packId: PackId;
}

/**
 * Boîte d'un nœud sur la planche — mêmes dimensions par type que Edges.tsx
 * (menu via rows, command/dialog box fixe) pour aligner les chips sur les nœuds.
 */
function sourceBox(
  pack: Pack,
  id: string,
  pos: { x: number; y: number },
): Box | null {
  const menu = pack.menus.find((m) => m.id === id);
  if (menu) return { ...pos, ...menuBoxSize(menu.rows) };
  if (pack.commands.some((c) => c.id === id)) return { ...pos, ...COMMAND_BOX };
  if ((pack.dialogs ?? []).some((d) => d.id === id)) return { ...pos, ...DIALOG_BOX };
  return null;
}

const CHIP_H = 22;
const CHIP_PAD = 8;
const CHAR_W = 6.2; // estimation largeur monospace 11px

export function GhostChips({ pack, layout, packId }: GhostChipsProps) {
  const activeLang = useUiStore((s) => s.activeLang);
  const links = useMemo(() => offBoardLinks(deriveEdges(pack), layout), [pack, layout]);

  return (
    <>
      {links.map(({ source, target }) => {
        const pos = layout[source];
        if (!pos) return null;
        const box = sourceBox(pack, source, pos);
        if (!box) return null;

        const label = `→ ${elementLabel(pack, target, activeLang)}`;
        const width = Math.max(48, label.length * CHAR_W + CHIP_PAD * 2);
        // Ancre : coin haut-droit de la source.
        const x = box.x + box.width + 8;
        const y = box.y;

        const onAdd = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
          e.cancelBubble = true;
          useAccountStore.getState().addToBoard({
            packId,
            nodeId: target,
            x: box.x + box.width + 40,
            y: box.y,
          });
        };

        return (
          <Group
            key={`${source}->${target}`}
            x={x}
            y={y}
            name={`ghostchip:${source}->${target}`}
            onClick={onAdd}
            onTap={onAdd}
          >
            <Rect
              width={width}
              height={CHIP_H}
              cornerRadius={CHIP_H / 2}
              fill="#1f1f23"
              stroke="#3f3f46"
              strokeWidth={1}
              perfectDrawEnabled={false}
            />
            <Text
              x={CHIP_PAD}
              y={CHIP_H / 2 - 6}
              text={label}
              fontFamily="ui-monospace, monospace"
              fontSize={11}
              fill="#a1a1aa"
              listening={false}
            />
          </Group>
        );
      })}
    </>
  );
}
