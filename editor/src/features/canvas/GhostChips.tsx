import type { Project } from "@/domain/types";
import { documentLabel } from "@/features/project/useProjectDocuments";
import { plainTextFromMiniMessage } from "@/lib/miniMessage";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { useMemo } from "react";
import { Group, Rect } from "react-konva";
import { deriveEdges } from "./deriveEdges";
import { nodeBox } from "./menuLayout";
import { offBoardLinks } from "./offBoardLinks";
import { VanillaMcText, vanillaTextWidth } from "./title/VanillaMcText";

interface GhostChipsProps {
  project: Project;
  layout: Record<string, { x: number; y: number }>;
  /**
   * In focus view, a click opens the target: the chip becomes navigation.
   * On the board every existing Document is already placed; a chip there only
   * signals a target missing from the project, with nothing to open.
   */
  onOpen?: (target: string) => void;
  representatives?: Record<string, string>;
}

const CHIP_H = 22;
const CHIP_PAD = 8;
const CHIP_GAP = 4; // vertical gap between stacked chips of the same source
// The label renders in the vanilla MC font, like menu titles: 1 px per font
// pixel, and a 12 px tall line (the tallest atlas cell, accented).
const TEXT_SCALE = 1;
const TEXT_H = 12;
const ARROW = "<#a1a1aa>→</#a1a1aa> ";

export function GhostChips({ project, layout, onOpen, representatives }: GhostChipsProps) {
  const activeLang = useUiStore((s) => s.activeLang);
  const links = useMemo(
    () =>
      offBoardLinks(deriveEdges(project), layout).filter(
        (e) => !representatives?.[e.target] || representatives[e.target] === e.target,
      ),
    [project, layout, representatives],
  );

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
        const box = nodeBox(project, source, layout);
        if (!box) return null;

        const i = indexBySource[idx] ?? 0;
        const label = documentLabel(project, target, activeLang);
        const chipText = ARROW + label;
        const width = Math.max(
          48,
          vanillaTextWidth(plainTextFromMiniMessage(chipText)) * TEXT_SCALE + CHIP_PAD * 2,
        );
        // Anchor: top-right corner of the source, offset vertically per chip.
        const x = box.x + box.width + 8;
        const y = box.y + i * (CHIP_H + CHIP_GAP);

        const open = onOpen
          ? (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
              e.cancelBubble = true;
              onOpen(target);
            }
          : undefined;

        return (
          <Group
            key={`${source}->${target}`}
            x={x}
            y={y}
            name={`ghostchip:${source}->${target}`}
            onClick={open}
            onTap={open}
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
            <VanillaMcText
              source={chipText}
              x={CHIP_PAD}
              y={(CHIP_H - TEXT_H * TEXT_SCALE) / 2}
              scale={TEXT_SCALE}
              defaultColor="#e4e4e7"
            />
          </Group>
        );
      })}
    </>
  );
}
