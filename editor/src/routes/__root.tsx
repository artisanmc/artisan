import { AdminSidebar } from "@/components/AdminSidebar";
import { ProjectSidebar } from "@/components/ProjectSidebar";
import { EditorWs } from "@/lib/editorWs";
import { useAuthStore } from "@/state/authStore";
import { useNetworksStore } from "@/state/networksStore";
import { useServersStore } from "@/state/serversStore";
import { useModulesStore } from "@/state/modulesStore";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useServerScreensStore } from "@/state/serverScreensStore";
import { useSidebarStore } from "@/state/sidebarStore";
import { PostHogProvider } from "@posthog/react";
import { Outlet, createRootRoute, useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import posthog from "posthog-js";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

posthog.init(import.meta.env.VITE_POSTHOG_PROJECT_TOKEN, {
  api_host: import.meta.env.VITE_POSTHOG_HOST,
  defaults: "2026-01-30",
  capture_pageview: false,
});

export const Route = createRootRoute({
  component: RootLayout,
});

export function RootLayout() {
  return (
    <PostHogProvider client={posthog}>
      <RootLayoutInner />
    </PostHogProvider>
  );
}

function RootLayoutInner() {
  usePostHogPageView();
  const { i18n } = useTranslation();
  const user = useAuthStore((s) => s.currentUser);
  const activeNetworkId = useNetworksStore((s) => s.activeId);
  const activeServerId = useServersStore((s) => s.activeServerId);
  const sidebarOpen = useSidebarStore((s) => s.isOpen);
  const closeSidebar = useSidebarStore((s) => s.close);
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
    useServerDataSourcesStore.getState().load({ networkId: activeNetworkId, serverId: activeServerId });
    useServerScreensStore.getState().load({ networkId: activeNetworkId, serverId: activeServerId });

    let cancelled = false;
    let ws: EditorWs | null = null;
    const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
    EditorWs.connectAsUser(apiUrl, (_projectId, menuId) => {
      // Capture the current i18n instance's translation at fire time — `t` is
      // deliberately not a dep below so a language switch doesn't reconnect the WS.
      toast(i18n.t("sync.draftConflict", { menuId }));
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
  const showSidebar = !!user;
  // Admin area swaps the workspace sidebar for the admin section nav.
  // Non-admins keep the workspace sidebar (the /admin layout shows "forbidden").
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isAdminArea = pathname.startsWith("/admin") && !!user?.isAdmin;
  return (
    <div className="relative flex h-full">
      {showSidebar && (
        <>
          {sidebarOpen ? (
            <div
              className="fixed inset-0 z-40 bg-black/50 lg:hidden"
              onClick={closeSidebar}
              aria-hidden
            />
          ) : null}
          <aside
            className={`fixed top-0 left-0 z-50 h-full w-[216px] shrink-0 bg-[var(--surface)] transition-transform duration-200 lg:relative lg:translate-x-0 ${
              sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
            }`}
          >
            {isAdminArea ? <AdminSidebar /> : <ProjectSidebar />}
          </aside>
          <button
            type="button"
            onClick={() => useSidebarStore.getState().open()}
            aria-label="Open sidebar"
            className="fixed top-3 left-3 z-30 flex size-[38px] items-center justify-center rounded-[10px] bg-[var(--surface-raised)] text-[var(--text-mut)] shadow-[var(--shadow-sm)] hover:text-[var(--text)] lg:hidden"
          >
            <Menu className="size-[18px]" />
          </button>
        </>
      )}
      <main className="flex flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}

function usePostHogPageView() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    posthog.capture("$pageview", { $current_url: window.location.href });
  }, [pathname]);
}

// L'auto-save a été retiré avec la bascule « disque seul » (ADR
// `server-disk-only-storage`, décision 3) : plus rien n'est écrit sans geste
// explicite. Ce qui n'est pas enregistré vit dans la page, comme dans n'importe
// quel éditeur — voir `saveProjectToDisk` et le bouton Enregistrer de la topbar.
