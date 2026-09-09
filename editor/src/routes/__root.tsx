import { AdminSidebar } from "@/components/AdminSidebar";
import { BackendUnreachable } from "@/components/BackendUnreachable";
import { NavigationSidebar } from "@/components/NavigationSidebar";
import { ProjectSidebar } from "@/components/ProjectSidebar";
import { onProjectsReloaded as onProjectsReloadedInEditor } from "@/features/project/onProjectsReloaded";
import { useDraftSync } from "@/features/project/useDraftSync";
import { EditorWs } from "@/lib/editorWs";
import { useAuthStore } from "@/state/authStore";
import { useModulesStore } from "@/state/modulesStore";
import { useNetworksStore } from "@/state/networksStore";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { useServersStore } from "@/state/serversStore";
import { PostHogProvider } from "@posthog/react";
import { Outlet, createRootRoute, useRouterState } from "@tanstack/react-router";
import posthog from "posthog-js";
import { analyticsEnabled, capturePageView } from "@/lib/analytics";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";


export const Route = createRootRoute({
  component: RootLayout,
});

export function RootLayout() {
  if (!analyticsEnabled) return <RootLayoutInner />;
  return (
    <PostHogProvider client={posthog}>
      <RootLayoutInner />
    </PostHogProvider>
  );
}

function RootLayoutInner() {
  // Tient le brouillon du navigateur à jour — rien n'atteint le disque sans le
  // geste Enregistrer, mais plus rien ne se perd à la fermeture d'un onglet.
  useDraftSync();
  usePostHogPageView();
  const { i18n } = useTranslation();
  const user = useAuthStore((s) => s.currentUser);
  const sessionStatus = useAuthStore((s) => s.sessionStatus);
  const backendUnreachable = useAuthStore((s) => s.backendUnreachable);
  const activeNetworkId = useNetworksStore((s) => s.activeId);
  const activeServerId = useServersStore((s) => s.activeServerId);
  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
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
    const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
    EditorWs.connectAsUser(apiUrl, {
      onDraftUpdate: (_projectId, menuId) => {
        // Capture the current i18n instance's translation at fire time — `t` is
        // deliberately not a dep below so a language switch doesn't reconnect the WS.
        toast(i18n.t("sync.draftConflict", { menuId }));
      },
      // Le serveur a rechargé : ce qu'on affiche peut être devenu faux. La
      // décision de relire (ou de ne rien faire) est prise dans
      // `onProjectsReloaded` — notamment, elle épargne le travail en cours.
      onProjectsReloaded: (serverKeyId, projects) => {
        onProjectsReloadedInEditor(serverKeyId, projects);
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
        // No WS ticket (e.g. cookie expired mid-session) — presence/assets
        // still work over REST, live co-edit notices are simply unavailable.
      });

    return () => {
      cancelled = true;
      ws?.disconnect();
    };
  }, [user, activeNetworkId, activeServerId]);
  // Session jamais déterminée + backend muet : on montre le vrai problème au
  // lieu d'une app à moitié rendue (ou d'un /login que le même backend anime).
  const sessionUndetermined = sessionStatus === "unknown" && backendUnreachable;
  const showSidebar = !!user;
  // Admin area swaps the workspace sidebar for the admin section nav.
  // Non-admins keep the workspace sidebar (the /admin layout shows "forbidden").
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAdminArea = pathname.startsWith("/admin") && !!user?.isAdmin;
  return (
    <div className="relative flex h-full">
      {showSidebar && (
        <NavigationSidebar>{isAdminArea ? <AdminSidebar /> : <ProjectSidebar />}</NavigationSidebar>
      )}
      <main className="flex flex-1 flex-col overflow-hidden">
        {sessionUndetermined ? <BackendUnreachable /> : <Outlet />}
      </main>
    </div>
  );
}

function usePostHogPageView() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    capturePageView(window.location.href);
  }, [pathname]);
}

// L'auto-save vers le SERVEUR a été retiré avec la bascule « disque seul » (ADR
// `server-disk-only-storage`) : rien n'atteint le disque sans le geste
// Enregistrer. Ce qui n'est pas enregistré vit dans le brouillon du navigateur
// (`useDraftSync` ci-dessus), donc survit à un rechargement — mais n'est pas
// une vérité pour autant : il est daté, propre à cet appareil, et ne devient
// réel qu'à l'enregistrement.
