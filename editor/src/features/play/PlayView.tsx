import { McScreen, McScreenControls, type McScreenSettings } from "@/components/mc-preview";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Project } from "@/domain/types";
import { buildPreviewScope } from "@/features/canvas/menuPreviewScope";
import { useServerActionsStore } from "@/state/serverActionsStore";
import { useServerSnapshotsStore } from "@/state/serverSnapshotsStore";
import { useUiStore } from "@/state/uiStore";
import { FastForward, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { PlayMenu } from "./PlayMenu";
import { PlayLauncher, PlayLog, TestPlayerPanel } from "./PlayPanels";
import { PlaySession } from "./engine/session";
import { type TestPlayer, loadTestPlayer, saveTestPlayer } from "./engine/testPlayer";

type SideTab = "launch" | "player" | "log";

/**
 * The Play view (spec "Mode Jeu"): the game's screen built from every Project of a server,
 * with no game client and no server running. The chat takes commands (T or /), menus open
 * and react to clicks, Triggers fire from the launcher; visual actions show on the screen,
 * the others go to the journal. Nothing here writes a Project.
 */
export function PlayView({
  serverId,
  projects,
  focus,
}: {
  serverId: string;
  projects: readonly Project[];
  /** The Project the launcher lists first (the one "Test in game" came from). */
  focus?: string;
}) {
  const { t } = useTranslation();
  const lang = useUiStore((s) => s.activeLang);
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const [player, setPlayer] = useState<TestPlayer>(() => loadTestPlayer(serverId));
  const playerRef = useRef(player);
  playerRef.current = player;
  const tRef = useRef(t);
  tRef.current = t;

  // biome-ignore lint/correctness/useExhaustiveDependencies: another server, another session
  const session = useMemo(
    () =>
      new PlaySession({
        projects: () => projectsRef.current,
        lang: () => useUiStore.getState().activeLang,
        player: () => playerRef.current,
        declaredActions: () => useServerActionsStore.getState().actions,
        t: (key, values) => tRef.current(key, values) as string,
        menuScope: (menu, p, args) =>
          buildPreviewScope(menu, p, useServerSnapshotsStore.getState().rowsByRef, args),
      }),
    [serverId],
  );
  useEffect(() => () => session.reset(), [session]);
  // What the modules declare names their actions' arguments in the journal.
  useEffect(() => {
    void useServerActionsStore.getState().load({ serverId });
  }, [serverId]);
  const state = useSyncExternalStore(session.subscribe, session.getState);

  const updatePlayer = (next: TestPlayer) => {
    setPlayer(next);
    saveTestPlayer(serverId, next);
  };

  const [settings, setSettings] = useState<McScreenSettings>({
    width: 1920,
    height: 1080,
    guiScale: "auto",
    zoom: "fit",
  });
  const [chatInput, setChatInput] = useState<string | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  const [recall, setRecall] = useState(-1);
  const screenRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const openChat = (initial: string) => {
    setChatInput(initial);
    setRecall(-1);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const closeChat = () => {
    setChatInput(null);
    screenRef.current?.focus();
  };

  // A new journal entry brings its tab forward, wherever the action came from.
  const [tab, setTab] = useState<SideTab>("launch");
  const lastId = state.log.at(-1)?.id ?? -1;
  const seenRef = useRef(lastId);
  useEffect(() => {
    if (lastId > seenRef.current) setTab("log");
    seenRef.current = lastId;
  }, [lastId]);

  const openMenu = state.menu ? session.menuOf(state.menu) : undefined;
  const menuProject = state.menu ? session.projectById(state.menu.projectId) : undefined;

  return (
    <div className="flex min-h-0 flex-1 gap-4 max-lg:flex-col" data-testid="play-view">
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <McScreenControls value={settings} onChange={setSettings} />
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => session.skipWaits()}
              title={t("play.skipHint")}
            >
              <FastForward className="size-4" />
              {t("play.skip")}
            </button>
            <button
              type="button"
              className="btn btn-outline btn-sm"
              onClick={() => {
                session.reset();
                setChatInput(null);
              }}
            >
              <RotateCcw className="size-4" />
              {t("play.reset")}
            </button>
          </div>
        </div>
        <div
          ref={screenRef}
          // The screen takes the game's keys, as an application does.
          role="application"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the screen takes the game's keys
          tabIndex={0}
          aria-label={t("play.screen")}
          data-testid="play-screen"
          className="relative min-h-0 overflow-auto rounded-[var(--r-sm)] outline-none focus-visible:shadow-[0_0_0_2px_var(--brand-line)]"
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget) return;
            if (e.key === "t" || e.key === "T") {
              e.preventDefault();
              openChat("");
            } else if (e.key === "/") {
              e.preventDefault();
              openChat("/");
            } else if ((e.key === "Escape" || e.key === "e" || e.key === "E") && state.menu) {
              // The game closes the menu; the workspace keeps its Esc for when none is open.
              e.preventDefault();
              e.stopPropagation();
              session.closeMenu();
            }
          }}
        >
          <McScreen
            {...settings}
            hotbar={{ selected: 0 }}
            survival={{ health: 20, food: 20, xp: 0, level: player.level }}
            chat={state.chat}
            chatInput={chatInput ?? undefined}
            title={state.title ?? undefined}
            actionBar={state.actionBar ?? undefined}
            screen={
              openMenu && menuProject && state.menu
                ? (geometry) => (
                    <PlayMenu
                      project={menuProject}
                      menu={openMenu}
                      open={state.menu!}
                      session={session}
                      lang={lang}
                      geometry={geometry}
                    />
                  )
                : undefined
            }
          />
          {chatInput !== null && (
            <input
              ref={inputRef}
              aria-label={t("play.chatInput")}
              data-testid="play-chat-input"
              className="absolute bottom-0 left-0 h-px w-px opacity-0"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onBlur={() => setChatInput((v) => (v === "" || v === "/" ? null : v))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (chatInput.trim()) {
                    session.sendChat(chatInput);
                    setSent((s) => [...s, chatInput].slice(-50));
                  }
                  closeChat();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  closeChat();
                } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                  e.preventDefault();
                  const next =
                    e.key === "ArrowUp"
                      ? Math.min(sent.length - 1, recall + 1)
                      : Math.max(-1, recall - 1);
                  setRecall(next);
                  setChatInput(next < 0 ? "" : (sent[sent.length - 1 - next] ?? ""));
                }
              }}
            />
          )}
        </div>
        <p className="text-[12px] text-[var(--text-faint)]">{t("play.keysHint")}</p>
      </section>
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as SideTab)}
        className="card flex min-h-0 w-[360px] shrink-0 flex-col max-lg:w-full"
        asChild
      >
        <aside>
          <TabsList className="border-b border-[var(--border)] p-2" aria-label={t("play.sidebar")}>
            <TabsTrigger value="launch">{t("play.launcher.title")}</TabsTrigger>
            <TabsTrigger value="player">{t("play.player.title")}</TabsTrigger>
            <TabsTrigger value="log">{t("play.log.title")}</TabsTrigger>
          </TabsList>
          <TabsContent value="launch" className="min-h-0 flex-1 overflow-y-auto p-4">
            <PlayLauncher
              projects={projects}
              focus={focus}
              session={session}
              onTypeCommand={(line) => openChat(line)}
            />
          </TabsContent>
          <TabsContent value="player" className="min-h-0 flex-1 overflow-y-auto p-4">
            <TestPlayerPanel player={player} onChange={updatePlayer} forced={state.forced} />
          </TabsContent>
          <TabsContent value="log" className="min-h-0 flex-1 overflow-y-auto p-4">
            <PlayLog entries={state.log} onClear={() => session.clearLog()} />
          </TabsContent>
        </aside>
      </Tabs>
    </div>
  );
}
