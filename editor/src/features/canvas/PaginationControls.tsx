import { Group, Rect, Text } from "react-konva";

interface PaginationControlsProps {
  y: number;
  width: number;
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * Editor-only Konva pagination row rendered beneath a menu when an
 * iterating element's source list overflows its position count. Lets the
 * user step through pages of sample data without touching the JSON.
 */
export function PaginationControls({
  y,
  width,
  page,
  totalPages,
  onPrev,
  onNext,
}: PaginationControlsProps) {
  const btnW = 28;
  const btnH = 18;
  const labelW = width - btnW * 2 - 8;
  const fontSize = 10;
  const canPrev = page > 0;
  const canNext = page < totalPages - 1;
  return (
    <Group y={y}>
      <Group
        x={0}
        listening={canPrev}
        opacity={canPrev ? 1 : 0.4}
        onClick={canPrev ? onPrev : undefined}
        onTap={canPrev ? onPrev : undefined}
      >
        <Rect width={btnW} height={btnH} fill="#271F1A" cornerRadius={3} />
        <Text
          x={0}
          y={0}
          width={btnW}
          height={btnH}
          text="◀"
          fontSize={fontSize}
          fill="#C9B7A3"
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      </Group>
      <Rect x={btnW + 4} width={labelW} height={btnH} fill="#14100D" cornerRadius={3} />
      <Text
        x={btnW + 4}
        y={0}
        width={labelW}
        height={btnH}
        text={`Page ${page + 1} / ${totalPages}`}
        fontSize={fontSize}
        fill="#C9B7A3"
        align="center"
        verticalAlign="middle"
        listening={false}
      />
      <Group
        x={btnW + 4 + labelW + 4}
        listening={canNext}
        opacity={canNext ? 1 : 0.4}
        onClick={canNext ? onNext : undefined}
        onTap={canNext ? onNext : undefined}
      >
        <Rect width={btnW} height={btnH} fill="#271F1A" cornerRadius={3} />
        <Text
          x={0}
          y={0}
          width={btnW}
          height={btnH}
          text="▶"
          fontSize={fontSize}
          fill="#C9B7A3"
          align="center"
          verticalAlign="middle"
          listening={false}
        />
      </Group>
    </Group>
  );
}
