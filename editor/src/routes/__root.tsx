import { NavigationSidebar } from "@/components/NavigationSidebar";
import { ProjectSidebar } from "@/components/ProjectSidebar";
import { onProjectsReloaded as onProjectsReloadedInEditor } from "@/features/project/onProjectsReloaded";
import { useDraftSync } from "@/features/project/useDraftSync";
import { EditorWs } from "@/lib/editorWs";
import { useAuthStore } from "@/state/authStore";
import { useModulesStore } from "@/state/modulesStore";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
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
        <Outlet />
      </main>
    </div>
  );
}
