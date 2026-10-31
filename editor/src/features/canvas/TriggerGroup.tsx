import { walkDocumentRefs } from "@/domain/actionArgs";
import { docKey } from "@/domain/documents";
import type { Project, ProjectId, Step } from "@/domain/types";
import { type ActionFamily, actionAppearance, actionLabel } from "@/lib/actions/actionFamily";
import { useCssVar } from "@/lib/themeColors";
import { TRIGGER_KIND, type Trigger } from "@/modules/triggers/trigger";
import { eventShortLabel } from "@/modules/triggers/triggerKind";
import { useAlignmentStore } from "@/state/alignmentStore";
import { useEdgeHoverStore } from "@/state/edgeHoverStore";
import { useSelectionStore } from "@/state/selectionStore";
import type Konva from "konva";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Group, Path, Rect, Text } from "react-konva";
import { dispatchOpenElement } from "./canvasEvents";
import { commitNodeDrag } from "./commitNodeDrag";
import { TRIGGER_ROWS, triggerBox, triggerRowY } from "./menuLayout";
import { useNodeColors } from "./nodeColors";
import { showFullTitle } from "./nodeTitle";
import { triggerRowsOpening } from "./subCommandAnchors";
import { useNodeAlignment } from "./useNodeAlignment";

/** Lucide's `zap`, drawn at 12 px: the trigger's mark before its id. */
const ZAP =
  "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z";

interface TriggerGroupProps {
  project: Project;
  trigger: Trigger;
  position: { x: number; y: number };
  /** The Trigger's own view (focus): nothing to move, nothing to open. */
  solo?: boolean;
}

/**
 * A Trigger on the board, read as a rule: its id in the trigger colour (and how many conditions
 * filter it), a "when" band naming its event, then its first steps as rows, each with its
 * action family's colour and the Document it opens. A link a shown step draws leaves from its
 * row (`triggerStepAnchors`); hovering one outlines that row. A disabled trigger is struck
 * and faded, like a command.
 */
export function TriggerGroup({ project, trigger, position, solo }: TriggerGroupProps) {
  const { t } = useTranslation();
  const key = docKey(TRIGGER_KIND.kind, trigger.id);
  const projectId = project.id as ProjectId;
  const isSelected = useSelectionStore((s) => s.menuId === null && s.ids.has(key));
  const nodeAlign = useNodeAlignment(projectId, key);
  const node = useNodeColors();
  const accent = useCssVar("--kind-trigger");
  const line = useCssVar("--kind-trigger-line");
  const families = useFamilyColors();
  const size = triggerBox(trigger);
  const width = TRIGGER_ROWS.width;
  const disabled = trigger.enabled === false;
  const shown = trigger.steps.slice(0, TRIGGER_ROWS.shown);
  const hidden = trigger.steps.length - shown.length;
  const conditions = trigger.conditions.length;

  // Only the hovered link's target when this trigger draws it: other nodes don't re-render.
  const hoveredTarget = useEdgeHoverStore((s) => (s.edge?.source === key ? s.edge.target : null));
  const linkedRows = useMemo(
    () => new Set(hoveredTarget ? triggerRowsOpening(project, trigger, hoveredTarget) : []),
    [project, trigger, hoveredTarget],
  );

  const onDragStart = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    e.target.moveToTop();
  }, []);

  const onDragEnd = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      commitNodeDrag(projectId, key, e.target);
      useAlignmentStore.getState().clear();
    },
    [projectId, key],
  );

  const onClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
      e.cancelBubble = true;
      const additive = "evt" in e && (e.evt.shiftKey || e.evt.metaKey || e.evt.ctrlKey);
      const { ids, menuId: selectionMenuId, set, toggle } = useSelectionStore.getState();
      if (additive) toggle(key);
      else if (selectionMenuId !== null || !ids.has(key) || ids.size > 1) set([key]);
    },
    [key],
  );

  const rowH = TRIGGER_ROWS.row - 3;
  const event = eventShortLabel(trigger.on);

  return (
    <Group
      x={position.x}
      y={position.y}
      draggable={!solo}
      opacity={disabled ? 0.55 : 1}
      onDragStart={onDragStart}
      onDragMove={nodeAlign.onDragMove}
      onDragEnd={onDragEnd}
      onClick={onClick}
      onTap={onClick}
      onDblClick={solo ? undefined : () => dispatchOpenElement(key)}
      onDblTap={solo ? undefined : () => dispatchOpenElement(key)}
      // The id may be cut by its ellipsis: the full one shows on hover.
      onMouseEnter={(e) => showFullTitle(e, trigger.id)}
      onMouseLeave={(e) => showFullTitle(e, null)}
      name={`${TRIGGER_KIND.kind}:${trigger.id}`}
      id={key}
    >
      <Rect
        width={size.width}
        height={size.height}
        cornerRadius={6}
        fill={node.bg}
        stroke={isSelected ? "#22c55e" : line}
        strokeWidth={isSelected ? 2 : 1.5}
        shadowColor="#000000"
        shadowBlur={10}
        shadowOpacity={node.shadow}
        shadowOffsetY={2}
        perfectDrawEnabled={false}
      />
      <Path
        x={9}
        y={7}
        data={ZAP}
        scaleX={0.5}
        scaleY={0.5}
        stroke={accent}
        strokeWidth={4}
        lineCap="round"
        lineJoin="round"
        listening={false}
      />
      <Text
        x={26}
        y={8}
        width={width - 36 - (conditions > 0 ? 52 : 0)}
        wrap="none"
        ellipsis
        text={trigger.id}
        fontFamily="ui-monospace, monospace"
        fontSize={12}
        fontStyle="600"
        textDecoration={disabled ? "line-through" : ""}
        fill={accent}
        listening={false}
      />
      {conditions > 0 ? (
        <Text
          x={width - 62}
          y={10}
          width={52}
          align="right"
          text={t("triggers.board.conditions", { count: conditions })}
          fontFamily="ui-monospace, monospace"
          fontSize={9}
          fill={node.sub}
          listening={false}
        />
      ) : null}
      {/* When: the event it listens to. */}
      <Group x={6} y={TRIGGER_ROWS.header} listening={false}>
        <Rect width={width - 12} height={rowH} cornerRadius={4} fill={accent} opacity={0.13} />
        <Text
          x={6}
          y={(rowH - 9) / 2}
          text={t("triggers.board.when")}
          fontFamily="ui-monospace, monospace"
          fontSize={9}
          fontStyle="600"
          letterSpacing={0.6}
          fill={accent}
        />
        <Text
          x={44}
          y={(rowH - 11) / 2}
          width={width - 12 - 50}
          wrap="none"
          ellipsis
          text={event}
          fontSize={11}
          fill={trigger.on ? node.fg : node.sub}
        />
      </Group>
      {shown.map((step, i) => {
        const row = stepRow(step, t);
        return (
          <Group
            // biome-ignore lint/suspicious/noArrayIndexKey: a step's place is its identity on the node
            key={i}
            x={6}
            y={triggerRowY(i)}
            listening={false}
          >
            <Rect
              width={width - 12}
              height={rowH}
              cornerRadius={4}
              fill={node.row}
              stroke={linkedRows.has(i) ? "#22c55e" : undefined}
              strokeWidth={linkedRows.has(i) ? 1.5 : 0}
              perfectDrawEnabled={false}
            />
            <Rect
              x={6}
              y={(rowH - 7) / 2}
              width={7}
              height={7}
              cornerRadius={2}
              fill={families[row.family]}
            />
            <Text
              x={19}
              y={(rowH - 11) / 2}
              width={width - 12 - 25 - (row.detail ? 56 : 0)}
              wrap="none"
              ellipsis
              text={row.label}
              fontSize={11}
              fill={node.rowFg}
            />
            {row.detail ? (
              <Text
                x={width - 12 - 62}
                y={(rowH - 9) / 2}
                width={56}
                align="right"
                wrap="none"
                ellipsis
                text={row.detail}
                fontFamily="ui-monospace, monospace"
                fontSize={9}
                fill={node.sub}
              />
            ) : null}
          </Group>
        );
      })}
      {hidden > 0 ? (
        <Text
          x={12}
          y={triggerRowY(shown.length) + 1}
          text={t("triggers.board.more", { count: hidden })}
          fontFamily="ui-monospace, monospace"
          fontSize={9}
          fill={node.sub}
          listening={false}
        />
      ) : null}
    </Group>
  );
}

/** A step as its row names it: the action (or `if`), its family, the Document it opens. */
function stepRow(
  step: Step,
  t: Parameters<typeof actionLabel>[1],
): { label: string; family: ActionFamily; detail: string } {
  const ref = [...walkDocumentRefs([step])].find((r) => r.id);
  const detail = ref?.id ?? "";
  if (step.kind === "if") return { label: t("actionCatalog.branch.if"), family: "logic", detail };
  const { family } = actionAppearance(step.action.name);
  return { label: actionLabel(step.action.name, t), family, detail };
}

/** Each action family's colour in the current theme: Konva paints literal colours only. */
function useFamilyColors(): Record<ActionFamily, string> {
  return {
    logic: useCssVar("--fam-logic"),
    message: useCssVar("--fam-message"),
    effect: useCssVar("--fam-effect"),
    navigation: useCssVar("--fam-navigation"),
    reward: useCssVar("--fam-reward"),
    world: useCssVar("--fam-world"),
    module: useCssVar("--fam-module"),
  };
}
