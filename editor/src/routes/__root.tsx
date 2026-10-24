import { LocalBundlesNotice } from "@/components/LocalBundlesNotice";
import { NavigationSidebar } from "@/components/NavigationSidebar";
import { ProjectSidebar } from "@/components/ProjectSidebar";
import { onProjectsReloaded as onProjectsReloadedInEditor } from "@/features/project/onProjectsReloaded";
import { useDraftSync } from "@/features/project/useDraftSync";
import { EditorWs } from "@/lib/editorWs";
import { useAuthStore } from "@/state/authStore";
import { useModulesStore } from "@/state/modulesStore";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerActionsStore } from "@/state/serverActionsStore";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useServerDocumentKindsStore } from "@/state/serverDocumentKindsStore";
import { useServerGameEventsStore } from "@/state/serverGameEventsStore";
import { useServerPapiPlaceholdersStore } from "@/state/serverPapiPlaceholdersStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { useServersStore } from "@/state/serversStore";
import { Outlet, createRootRoute } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createRootRoute({
  component: RootLayout,
});

export function RootLayout() {
  // Keeps the browser draft up to date — nothing reaches the disk without an
  // explicit save, but nothing is lost when a tab closes.
  useDraftSync();
  const user = useAuthStore((s) => s.currentUser);
  const userId = user?.id;
  const activeServerId = useServersStore((s) => s.activeServerId);
  useEffect(() => {
    const catalog = useServerPapiPlaceholdersStore.getState();
    if (!userId || !activeServerId) {
      catalog.clear();
      return;
    }
    const scope = { userId, serverId: activeServerId };
    const refresh = () => {
      void catalog.load(scope);
    };
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => {
      clearInterval(timer);
      catalog.clear();
    };
  }, [userId, activeServerId]);
  useEffect(() => {
    useAuthStore.getState().hydrate();
  }, []);
  // Presence + live draft WS as soon as the active server is
  // known — cf. ProjectSidebar which resolves `activeServerId` to the exact
  // server_key id (not a slug).
  useEffect(() => {
    if (!user || !activeServerId) return;
    useModulesStore.getState().integrate({ serverId: activeServerId });
    useServerDataSourcesStore.getState().load({ serverId: activeServerId });
    useServerScreensStore.getState().load({ serverId: activeServerId });
    useServerActionsStore.getState().load({ serverId: activeServerId });
    useServerDocumentKindsStore.getState().load({ serverId: activeServerId });
    useServerGameEventsStore.getState().load({ serverId: activeServerId });
    // Declared actions arriving after a project was read: adopt the texts of the module
    // actions it holds, so they are i18n sites like a core action's.
    const unsubscribeActions = useServerActionsStore.subscribe((s, prev) => {
      if (s.status !== "ready" || prev.status === "ready") return;
      const { openProjects, adoptActionTexts } = useProjectsStore.getState();
      for (const p of openProjects.projects) {
        if (p.serverKeyId === activeServerId) adoptActionTexts({ projectId: p.id });
      }
    });

    // A module view arriving after a project was read: its Documents were kept as raw
    // files until its kind existed; read them now.
    const unsubscribeModules = useModulesStore.subscribe((s, prev) => {
      if (s.status !== "ready" || prev.status === "ready") return;
      const { openProjects, adoptLateDocuments } = useProjectsStore.getState();
      for (const p of openProjects.projects) {
        if (p.serverKeyId === activeServerId) adoptLateDocuments({ projectId: p.id });
      }
    });

    let cancelled = false;
    const ws = new EditorWs({
      // The server reloaded: what is shown may have become wrong. The decision to
      // re-read (or to do nothing) is made in `onProjectsReloaded` — in particular,
      // it spares work in progress.
      onProjectsReloaded: (serverKeyId, projects) => {
        onProjectsReloadedInEditor(serverKeyId, projects);
        if (
          !cancelled &&
          serverKeyId === activeServerId &&
          useServerPapiPlaceholdersStore.getState().key
        ) {
          void useServerPapiPlaceholdersStore
            .getState()
            .load({ userId: user.id, serverId: activeServerId });
        }
      },
    });

    return () => {
      cancelled = true;
      unsubscribeActions();
      unsubscribeModules();
      ws?.disconnect();
    };
  }, [user, activeServerId]);
  return (
    <div className="relative flex h-full">
      {user && (
        <NavigationSidebar>
          <ProjectSidebar />
        </NavigationSidebar>
      )}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <LocalBundlesNotice />
        <Outlet />
      </main>
    </div>
  );
}
