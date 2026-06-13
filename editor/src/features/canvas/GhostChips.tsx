import type { Pack, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { elementLabel } from "@/features/workspace/usePackElements";
import type Konva from "konva";
import { useMemo } from "react";
import { Group, Rect, Text } from "react-konva";
import { deriveEdges } from "./deriveEdges";
import { nodeBox } from "./menuLayout";
import { offBoardLinks } from "./offBoardLinks";

interface GhostChipsProps {
  pack: Pack;
  layout: Record<string, { x: number; y: number }>;
  packId: PackId;
}

const CHIP_H = 22;
const CHIP_PAD = 8;
const CHIP_GAP = 4; // vertical gap between stacked chips of the same source
// Char-width estimate calibrated for the chip Text (ui-monospace, ~11px).
// If that font/size changes, re-tune this.
const CHAR_W = 6.2;

export function GhostChips({ pack, layout, packId }: GhostChipsProps) {
  const activeLang = useUiStore((s) => s.activeLang);
  const links = useMemo(() => offBoardLinks(deriveEdges(pack), layout), [pack, layout]);

  // Index of each link within its source group — used to stagger overlapping chips.
  const indexBySource = useMemo(() => {
    const counts: Record<string, number> = {};
    return links.map(({ source }) => {
      const i = counts[source] ?? 0;
      counts[source] = i + 1;
      return i;
    });
  }, [links]);

  return (
    <>
      {links.map(({ source, target }, idx) => {
        const box = nodeBox(pack, source, layout);
        if (!box) return null;

        const i = indexBySource[idx] ?? 0;
        const label = `→ ${elementLabel(pack, target, activeLang)}`;
        const width = Math.max(48, label.length * CHAR_W + CHIP_PAD * 2);
        // Ancre : coin haut-droit de la source, décalé verticalement par chip.
        const x = box.x + box.width + 8;
        const y = box.y + i * (CHIP_H + CHIP_GAP);

        const onAdd = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
          e.cancelBubble = true;
          useAccountStore.getState().addToBoard({
            packId,
            nodeId: target,
            x: box.x + box.width + 40,
            y: box.y + i * (CHIP_H + CHIP_GAP),
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
