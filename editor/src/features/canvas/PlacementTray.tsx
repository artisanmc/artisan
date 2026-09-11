import { resolveDisplayRef } from "@/domain/capturedItems";
import type { Menu, Project } from "@/domain/types";
import { lookupPath } from "@/lib/placeholders";
import { useCssVar } from "@/lib/themeColors";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { useTranslation } from "react-i18next";
import { Group, Rect, Text } from "react-konva";
import { SlotItem } from "./SlotItem";
import { previewItem } from "./itemValuePreview";
import { TEX_SCALE, TEX_SLOT_INNER_OFFSET } from "./menuLayout";
import { unplacedRows } from "./unplacedRows";

const CELL = 18 * TEX_SCALE;
const PAD = 4;
const CARDS_TOP = 16;
const LABEL_GAP = 2;
const LABEL_HEIGHT = 9;
const TRAY_HEIGHT = CARDS_TOP + CELL + LABEL_GAP + LABEL_HEIGHT + PAD;

/**
 * Les lignes qu'il reste à poser, sous le menu qui les attend.
 *
 * Le mécanisme de pose existait déjà (armer une ligne, taper un slot) mais vivait
 * dans le panneau de propriétés : ajouter une catégorie ne se voyait nulle part
 * sur la planche. Le plateau n'apparaît QUE s'il reste du travail — c'est un
 * signal, pas un meuble — et il suit le **Preview context**, donc son contenu
 * change quand on navigue d'une catégorie à l'autre.
 *
 * Cf. ADR `parameterised-menu-over-menu-per-category`.
 */
export function PlacementTray({
  menu,
  project,
  scope,
  boxWidth,
  boxHeight,
}: {
  menu: Menu;
  project: Project | undefined;
  /** Portée d'aperçu déjà résolue par le menu (contexte + sources). */
  scope: Record<string, unknown>;
  boxWidth: number;
  boxHeight: number;
}) {
  const { t } = useTranslation();
  const activeLang = useUiStore((s) => s.activeLang);
  const armed = useUiStore((s) => s.armedPlacement);
  const setArmed = useUiStore((s) => s.setArmedPlacement);
  const brand = useCssVar("--brand");
  const faint = useCssVar("--text-faint");

  if (!project) return null;

  // Un plateau par Élément en mode placement — en pratique il y en a un.
  const pending: {
    elementId: string;
    keyField: string;
    alias: string;
    rows: Record<string, unknown>[];
    material?: string;
  }[] = [];
  for (const layer of menu.layers) {
    for (const el of layer.elements) {
      const places = el.places;
      if (!places) continue;
      const rows = lookupPath(scope, places.source);
      if (!Array.isArray(rows)) continue;
      const left = unplacedRows(
        { keyField: places.keyField, placements: places.placements ?? [] },
        rows as Record<string, unknown>[],
      );
      if (left.length === 0) continue;
      pending.push({
        elementId: el.id as string,
        keyField: places.keyField,
        alias: places.alias,
        rows: left,
        material: el.display?.item ?? el.display?.material,
      });
    }
  }
  if (pending.length === 0) return null;

  let y = boxHeight + 8;
  return (
    <>
      {pending.map((group) => {
        const width = Math.max(boxWidth, group.rows.length * (CELL + PAD) + PAD);
        const top = y;
        y += TRAY_HEIGHT + PAD;
        return (
          <Group key={group.elementId} y={top}>
            <Rect
              width={width}
              height={TRAY_HEIGHT}
              cornerRadius={4}
              fill="#00000066"
              stroke={faint}
              strokeWidth={1}
              perfectDrawEnabled={false}
            />
            <Text
              text={t("canvas.placementTrayLead", { count: group.rows.length })}
              x={PAD + 2}
              y={3}
              fontSize={10}
              fill={faint}
              listening={false}
            />
            {group.rows.map((row, i) => {
              const key = String(row[group.keyField]);
              const isArmed =
                armed?.menuId === menu.id &&
                armed.elementId === group.elementId &&
                armed.key === key;
              // La tuile porte l'apparence de l'Élément, résolue contre SA ligne :
              // on voit ce qu'on va poser, pas un carré gris.
              const rawMaterial = group.material
                ? previewItem(
                    { material: group.material },
                    { ...scope, [group.alias]: row },
                    project,
                    activeLang,
                  ).material
                : undefined;
              const display = rawMaterial ? resolveDisplayRef(project, rawMaterial) : undefined;
              const label = String(row.name ?? row.id ?? key);
              return (
                <Group
                  key={key}
                  x={PAD + i * (CELL + PAD)}
                  y={CARDS_TOP}
                  onClick={(ev: Konva.KonvaEventObject<MouseEvent>) => {
                    ev.cancelBubble = true;
                    setArmed(isArmed ? null : { menuId: menu.id, elementId: group.elementId, key });
                  }}
                  onTap={(ev: Konva.KonvaEventObject<Event>) => {
                    ev.cancelBubble = true;
                    setArmed(isArmed ? null : { menuId: menu.id, elementId: group.elementId, key });
                  }}
                >
                  <Rect
                    width={CELL}
                    height={CELL}
                    cornerRadius={2}
                    stroke={isArmed ? brand : "transparent"}
                    strokeWidth={2}
                    fill="rgba(20,20,20,0.35)"
                    perfectDrawEnabled={false}
                  />
                  <SlotItem
                    material={display?.material ?? rawMaterial ?? ""}
                    head={display?.head}
                    enchanted={display?.enchanted}
                    innerX={TEX_SLOT_INNER_OFFSET}
                    innerY={TEX_SLOT_INNER_OFFSET}
                  />
                  <Text
                    text={label}
                    y={CELL + LABEL_GAP}
                    height={LABEL_HEIGHT}
                    width={CELL}
                    fontSize={7}
                    align="center"
                    fill={faint}
                    ellipsis
                    wrap="none"
                    listening={false}
                  />
                </Group>
              );
            })}
          </Group>
        );
      })}
    </>
  );
}
