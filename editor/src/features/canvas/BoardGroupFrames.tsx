import { DEFAULT_GROUP_COLOR } from "@/domain/canvasGroups";
import { useCssVar } from "@/lib/themeColors";
import type Konva from "konva";
import { useRef } from "react";
import { Group, Rect, Text } from "react-konva";
import type { BoardGroup } from "./groupedBoard";

export interface GroupDrag {
  key: string;
  dx: number;
  dy: number;
}

interface Props {
  groups: BoardGroup[];
  /** The selected folder: its frame is outlined. */
  selected?: string | null;
  /** Frames take clicks and drags; off, they only draw. */
  interactive?: boolean;
  onSelect?: (group: BoardGroup) => void;
  onShowOnly?: (group: BoardGroup) => void;
  onDrag?: (drag: GroupDrag | null) => void;
  onMove?: (group: BoardGroup, dx: number, dy: number) => void;
}

export function BoardGroupFrames(props: Props) {
  return (
    <>
      {props.groups.map((group) => (
        <Frame key={group.key} {...props} group={group} />
      ))}
    </>
  );
}

function Frame({
  group,
  selected,
  interactive = true,
  onSelect,
  onShowOnly,
  onDrag,
  onMove,
}: Props & { group: BoardGroup }) {
  const border = useCssVar("--border-strong");
  const text = useCssVar("--text");
  const muted = useCssVar("--text-mut");
  const color = group.kind === "group" ? (group.color ?? DEFAULT_GROUP_COLOR) : border;
  const start = useRef({ x: 0, y: 0 });
  const stop = (e: Konva.KonvaEventObject<Event>) => {
    e.cancelBubble = true;
  };
  const select = (e: Konva.KonvaEventObject<Event>) => {
    stop(e);
    onSelect?.(group);
  };
  const showOnly = (e: Konva.KonvaEventObject<Event>) => {
    stop(e);
    onShowOnly?.(group);
  };
  const isSelected = group.kind === "group" && selected === group.id;
  return (
    <Group
      x={group.x}
      y={group.y}
      name={`board-group:${group.key}`}
      draggable={!!onMove && interactive}
      listening={interactive}
      onClick={select}
      onTap={select}
      onDblClick={showOnly}
      onDblTap={showOnly}
      onDragStart={(e) => {
        stop(e);
        start.current = { x: group.x, y: group.y };
      }}
      onDragMove={(e) => {
        stop(e);
        onDrag?.({
          key: group.key,
          dx: e.target.x() - start.current.x,
          dy: e.target.y() - start.current.y,
        });
      }}
      onDragEnd={(e) => {
        stop(e);
        const dx = e.target.x() - start.current.x;
        const dy = e.target.y() - start.current.y;
        onMove?.(group, dx, dy);
        onDrag?.(null);
      }}
    >
      {/* The whole background takes the press: a click selects, a drag moves the frame. */}
      <Rect
        width={group.width}
        height={group.height}
        fill={color}
        opacity={0.15}
        cornerRadius={12}
      />
      <Rect
        width={group.width}
        height={group.height}
        stroke={color}
        strokeWidth={isSelected ? 2.5 : 1}
        opacity={isSelected ? 1 : 0.65}
        cornerRadius={12}
        listening={false}
      />
      <Text
        x={16}
        y={13}
        width={group.width - 72}
        height={20}
        text={group.name}
        ellipsis
        wrap="none"
        fontSize={14}
        fill={text}
        listening={false}
      />
      <Text
        x={group.width - 48}
        y={13}
        width={32}
        align="right"
        text={String(group.members.length)}
        fontSize={12}
        fill={muted}
        listening={false}
      />
    </Group>
  );
}
