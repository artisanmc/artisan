import type { Menu, Project } from "@/domain/types";
import { useCssVar } from "@/lib/themeColors";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Group, Rect, Text } from "react-konva";
import { findPreviewCallContexts } from "./previewCallContexts";
import { currentCallIndex } from "./previewCallNavigation";
import { resolvedContexts } from "./resolvedContexts";

const HEIGHT = 18;
const ROW = 16;

/**
 * Le **Preview context** d'un menu paramétré, affiché sur le menu lui-même.
 *
 * Un menu à inputs est un document pour N écrans : ses Placements portent tous
 * les contextes à la fois, et sans contexte posé il ne rend RIEN (le filtre
 * compare à une valeur vide). Laisser ça dans un panneau de propriétés donnait
 * un menu vide que rien n'expliquait — d'où ce bandeau, qui dit toujours quel
 * écran on regarde et ouvre la liste des autres.
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
  const setMenuPreviewArg = useUiStore((s) => s.setMenuPreviewArg);
  const snapshots = useServerSnapshotsStore((s) => s.rowsByRef);
  const brand = useCssVar("--brand");
  const faint = useCssVar("--text-faint");
  const warning = useCssVar("--warning");
  const [open, setOpen] = useState(false);

  // Un menu sans input n'a qu'un écran : rien à choisir, rien à afficher.
  if (!project || (menu.contextInputs ?? []).length === 0) return null;
  const all = findPreviewCallContexts(menu, project, snapshots, activeLang);
  if (all.length === 0) return null;

  // Sans données de source (serveur non connecté), les arguments du lien
  // ressortent bruts : `{cat}`. Les proposer donnerait un choix qui ne change
  // rien — mieux vaut dire que les données manquent.
  const contexts = resolvedContexts(all);
  const stale = contexts.length === 0;

  const current = currentCallIndex(contexts, previewArgs);
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
    for (const [k, v] of Object.entries(c.args)) setMenuPreviewArg(menu.id, k, v);
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
