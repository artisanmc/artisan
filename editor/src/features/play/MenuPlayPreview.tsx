import { McScreen } from "@/components/mc-preview";
import type { Project } from "@/domain/types";
import { buildPreviewScope } from "@/features/canvas/menuPreviewScope";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useUiStore } from "@/state/uiStore";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { PlayMenu } from "./PlayMenu";
import { PlaySession } from "./engine/session";
import { loadTestPlayer } from "./engine/testPlayer";

/**
 * One menu as the game shows it, open on its own screen: the Play engine over [projects], with
 * [menuId] of [projectId] opened as an `open_menu` would. Clicks run as in Play mode (another menu
 * may open); nothing here writes a Project. The server's Assistant tab shows a draft's menu with
 * it, [projects] carrying the draft's version of its Project.
 */
export function MenuPlayPreview({
  serverId,
  projects,
  projectId,
  menuId,
}: {
  serverId: string;
  projects: readonly Project[];
  projectId: string;
  menuId: string;
}) {
  const { t } = useTranslation();
  const lang = useUiStore((s) => s.activeLang);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const tRef = useRef(t);
  tRef.current = t;

  const session = useMemo(() => {
    const player = loadTestPlayer(serverId);
    return new PlaySession({
      projects: () => projectsRef.current,
      lang: () => useUiStore.getState().activeLang,
      player: () => player,
      t: (key, values) => tRef.current(key, values) as string,
      menuScope: (menu, p, args) =>
        buildPreviewScope(menu, p, useServerSnapshotsStore.getState().rowsByRef, args),
    });
  }, [serverId]);
  // The menu again whenever the Project changes (the assistant wrote the file once more).
  // biome-ignore lint/correctness/useExhaustiveDependencies: new projects, the menu opened again
  useEffect(() => {
    session.reset();
    session.openMenuById(projectId, menuId);
  }, [session, projects, projectId, menuId]);
  useEffect(() => () => session.reset(), [session]);
  const state = useSyncExternalStore(session.subscribe, session.getState);

  const open = state.menu;
  const menu = open ? session.menuOf(open) : undefined;
  const project = open ? session.projectById(open.projectId) : undefined;
  return (
    <McScreen
      width={960}
      height={540}
      guiScale="auto"
      zoom="fit"
      hotbar={false}
      title={state.title ?? undefined}
      actionBar={state.actionBar ?? undefined}
      screen={
        open && menu && project
          ? (geometry) => (
              <PlayMenu
                project={project}
                menu={menu}
                open={open}
                session={session}
                lang={lang}
                geometry={geometry}
              />
            )
          : undefined
      }
    />
  );
}
