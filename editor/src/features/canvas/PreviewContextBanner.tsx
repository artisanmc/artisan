import type { Menu, Project } from "@/domain/types";
import { useCssVar } from "@/lib/themeColors";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useUiStore } from "@/state/uiStore";
import type Konva from "konva";
import { useTranslation } from "react-i18next";
import { Group, Rect, Text } from "react-konva";
import { findPreviewCallContexts } from "./previewCallContexts";
import { currentCallIndex, nextCallContext } from "./previewCallNavigation";

const HEIGHT = 18;

/**
 * Le **Preview context** d'un menu paramétré, affiché sur le menu lui-même.
 *
 * Un menu à inputs est un document pour N écrans : ses Placements portent tous
 * les contextes à la fois, et sans contexte posé il ne rend RIEN (le filtre
 * compare à une valeur vide). Laisser ça dans un panneau de propriétés donnait
 * un menu vide que rien n'expliquait — d'où ce bandeau, qui dit toujours quel
 * écran on regarde. Cliquer passe au suivant.
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

  // Un menu sans input n'a qu'un écran : rien à choisir, rien à afficher.
  if (!project || (menu.contextInputs ?? []).length === 0) return null;
  const contexts = findPreviewCallContexts(menu, project, snapshots, activeLang);
  if (contexts.length === 0) return null;

  const current = currentCallIndex(contexts, previewArgs);
  const active = current >= 0 ? contexts[current] : null;
  const label = active
    ? t("canvas.previewContextBanner", { from: active.from, label: active.label })
    : t("canvas.previewContextPickOne");

  const cycle = () => {
    const next = nextCallContext(contexts, previewArgs);
    if (!next) return;
    for (const [k, v] of Object.entries(next.args)) setMenuPreviewArg(menu.id, k, v);
  };

  return (
    <Group
      y={-HEIGHT - 4}
      onClick={(ev: Konva.KonvaEventObject<MouseEvent>) => {
        ev.cancelBubble = true;
        cycle();
      }}
      onTap={(ev: Konva.KonvaEventObject<Event>) => {
        ev.cancelBubble = true;
        cycle();
      }}
    >
      <Rect
        width={width}
        height={HEIGHT}
        cornerRadius={3}
        fill="#00000055"
        stroke={active ? brand : faint}
        strokeWidth={1}
        perfectDrawEnabled={false}
      />
      <Text
        text={label}
        width={width - 10}
        x={5}
        y={4}
        fontSize={11}
        fill={active ? brand : faint}
        ellipsis
        wrap="none"
        listening={false}
      />
    </Group>
  );
}
