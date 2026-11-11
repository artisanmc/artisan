import type { Menu, Project } from "@/domain/types";
import { useCssVar } from "@/lib/themeColors";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Group, Rect, Text } from "react-konva";
import { findPreviewCallContexts } from "./previewCallContexts";
import { currentCallIndex, effectivePreviewArgs } from "./previewCallNavigation";
import { resolvedContexts } from "./resolvedContexts";

const HEIGHT = 18;
const ROW = 16;

/**
 * The **Preview context** of a parameterised menu, shown on the menu itself.
 *
 * A menu with inputs is one document for N screens: its Placements carry every
 * context at once, and with no context set it renders NOTHING (the filter
 * compares to an empty value). Leaving that in a properties panel gave an
 * empty menu that nothing explained — hence this banner, which always says
 * which screen is shown and opens the list of the others.
 *
 * Cf. ADR `parameterised-menu-over-menu-per-category`.
 */
export function PreviewContextBanner({
  menu,
  project,
  width,
  previewArgs,
}: {
  menu: Menu;
  project: Project | undefined;
  width: number;
  previewArgs: Record<string, unknown> | undefined;
}) {
  const { t } = useTranslation();
  const activeLang = useUiStore((s) => s.activeLang);
  const setMenuPreviewArgs = useUiStore((s) => s.setMenuPreviewArgs);
  const snapshots = useServerSnapshotsStore((s) => s.rowsByRef);
  const brand = useCssVar("--brand");
  const faint = useCssVar("--text-faint");
  const warning = useCssVar("--warning");
  const [open, setOpen] = useState(false);

  const hasInputs = !!project && (menu.contextInputs ?? []).length > 0;
  const all = hasInputs
    ? findPreviewCallContexts(menu, project as Project, snapshots, activeLang)
    : [];
  // Without source data (server not connected), the link arguments come out
  // raw: `{cat}`. Offering them would give a choice that changes nothing —
  // better to say the data is missing.
  const contexts = resolvedContexts(all);
  // An input's default counts: it is the screen the canvas already renders.
  const current = currentCallIndex(contexts, effectivePreviewArgs(menu, previewArgs));

  /**
   * Nothing chosen ⇒ take the first known call.
   *
   * The screen was not "without context" before that: the input defaults
   * already applied, so the canvas rendered a specific category while the
   * banner asked for a choice. Worse, that in-between state was inconsistent —
   * the filter was `les_cles` but the category NAME stayed empty, a screen that
   * matches no real call.
   *
   * Picking the first call makes the display match what it announces, and the
   * user remains free to change it.
   */
  useEffect(() => {
    if (current >= 0 || contexts.length === 0) return;
    const first = contexts[0];
    if (!first) return;
    setMenuPreviewArgs(menu.id, first.args);
  }, [current, contexts, menu.id, setMenuPreviewArgs]);

  // A menu without inputs has a single screen: nothing to choose, nothing to show.
  if (!hasInputs || all.length === 0) return null;

  const stale = contexts.length === 0;
  const active = current >= 0 ? contexts[current] : null;
  const label = stale
    ? t("canvas.previewContextNoData")
    : active
      ? t("canvas.previewContextBanner", { from: active.from, label: active.label })
      : t("canvas.previewContextPickOne");

  const apply = (idx: number) => {
    const c = contexts[idx];
    setOpen(false);
    if (!c) return;
    setMenuPreviewArgs(menu.id, c.args);
  };

  const color = stale ? warning : active ? brand : faint;

  return (
    <Group y={-HEIGHT - 4}>
      <Group
        onClick={(ev: Konva.KonvaEventObject<MouseEvent>) => {
          ev.cancelBubble = true;
          if (!stale) setOpen((o) => !o);
        }}
        onTap={(ev: Konva.KonvaEventObject<Event>) => {
          ev.cancelBubble = true;
          if (!stale) setOpen((o) => !o);
        }}
      >
        <Rect
          width={width}
          height={HEIGHT}
          cornerRadius={3}
          fill="#00000055"
          stroke={color}
          strokeWidth={1}
          perfectDrawEnabled={false}
        />
        <Text
          text={label}
          width={width - 22}
          x={5}
          y={4}
          fontSize={11}
          fill={color}
          ellipsis
          wrap="none"
          listening={false}
        />
        {!stale && (
          <Text
            text={open ? "▲" : "▼"}
            x={width - 14}
            y={4}
            fontSize={9}
            fill={color}
            listening={false}
          />
        )}
      </Group>

      {open && (
        <Group y={HEIGHT + 2}>
          <Rect
            width={width}
            height={contexts.length * ROW + 4}
            cornerRadius={3}
            fill="#111318ee"
            stroke={brand}
            strokeWidth={1}
            perfectDrawEnabled={false}
          />
          {contexts.map((c, i) => (
            <Group
              key={`${c.from}:${c.label}:${i}`}
              y={2 + i * ROW}
              onClick={(ev: Konva.KonvaEventObject<MouseEvent>) => {
                ev.cancelBubble = true;
                apply(i);
              }}
              onTap={(ev: Konva.KonvaEventObject<Event>) => {
                ev.cancelBubble = true;
                apply(i);
              }}
            >
              <Rect
                width={width}
                height={ROW}
                fill={i === current ? "#ffffff14" : "transparent"}
                perfectDrawEnabled={false}
              />
              <Text
                text={`${c.from} › ${c.label}`}
                x={7}
                y={3}
                width={width - 14}
                fontSize={10}
                fill={i === current ? brand : faint}
                ellipsis
                wrap="none"
                listening={false}
              />
            </Group>
          ))}
        </Group>
      )}
    </Group>
  );
}
