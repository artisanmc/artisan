import { NavigationSidebar } from "@/components/NavigationSidebar";
import { ProjectSidebar } from "@/components/ProjectSidebar";
import { onProjectsReloaded as onProjectsReloadedInEditor } from "@/features/project/onProjectsReloaded";
import { useDraftSync } from "@/features/project/useDraftSync";
import { EditorWs } from "@/lib/editorWs";
import { useAuthStore } from "@/state/authStore";
import { useModulesStore } from "@/state/modulesStore";
import { useNetworksStore } from "@/state/networksStore";
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
  // Tient le brouillon du navigateur à jour — rien n'atteint le disque sans le
  // geste Enregistrer, mais plus rien ne se perd à la fermeture d'un onglet.
  useDraftSync();
  const user = useAuthStore((s) => s.currentUser);
  const userId = user?.id;
  const activeNetworkId = useNetworksStore((s) => s.activeId);
  const activeServerId = useServersStore((s) => s.activeServerId);
  useEffect(() => {
    const catalog = useServerPapiPlaceholdersStore.getState();
    if (!userId || !activeNetworkId || !activeServerId) {
      catalog.clear();
      return;
    }
    const scope = { userId, networkId: activeNetworkId, serverId: activeServerId };
    const refresh = () => { void catalog.load(scope); };
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => { clearInterval(timer); catalog.clear(); };
  }, [userId, activeNetworkId, activeServerId]);
  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL ?? "";
    useAuthStore.getState().hydrate(apiUrl);
  }, []);
  // Presence + live draft WS as soon as the active network+server pair is
  // known — cf. ProjectSidebar which resolves `activeServerId` to the exact
  // server_key id (not a slug).
  useEffect(() => {
    if (!user || !activeNetworkId || !activeServerId) return;
    useModulesStore.getState().integrate({ networkId: activeNetworkId, serverId: activeServerId });
    useServerDataSourcesStore
      .getState()
      .load({ networkId: activeNetworkId, serverId: activeServerId });
    useServerScreensStore.getState().load({ networkId: activeNetworkId, serverId: activeServerId });

    let cancelled = false;
    let ws: EditorWs | null = null;
    const apiUrl = import.meta.env.VITE_API_URL ?? "";
    EditorWs.connectAsUser(apiUrl, {
      // Le serveur a rechargé : ce qu'on affiche peut être devenu faux. La
      // décision de relire (ou de ne rien faire) est prise dans
      // `onProjectsReloaded` — notamment, elle épargne le travail en cours.
      onProjectsReloaded: (serverKeyId, projects) => {
        onProjectsReloadedInEditor(serverKeyId, projects);
        if (!cancelled && serverKeyId === activeServerId && useServerPapiPlaceholdersStore.getState().key) {
          void useServerPapiPlaceholdersStore.getState().load({ userId: user.id, networkId: activeNetworkId, serverId: activeServerId });
        }
      },
    })
      .then((connected) => {
        if (cancelled) {
          connected.disconnect();
          return;
        }
        ws = connected;
      })
      .catch(() => {
        // No WS ticket (e.g. cookie expired mid-session) — everything still
        // works over REST, reload notices are simply unavailable.
      });

    return () => {
      cancelled = true;
      ws?.disconnect();
    };
  }, [user, activeNetworkId, activeServerId]);
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

// L'auto-save vers le SERVEUR a été retiré avec la bascule « disque seul » (ADR
// `server-disk-only-storage`) : rien n'atteint le disque sans le geste
// Enregistrer. Ce qui n'est pas enregistré vit dans le brouillon du navigateur
// (`useDraftSync` ci-dessus), donc survit à un rechargement — mais n'est pas
// une vérité pour autant : il est daté, propre à cet appareil, et ne devient
// réel qu'à l'enregistrement.
