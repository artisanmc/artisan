import { AdminSidebar } from "@/components/AdminSidebar";
import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";
import type { Pack } from "@/domain/types";
import { persistPack } from "@/features/pack/persistPack";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useSessionStore } from "@/state/sessionStore";
import { useModulesStore } from "@/state/modulesStore";
import { useSidebarStore } from "@/state/sidebarStore";
import { PostHogProvider } from "@posthog/react";
import { Outlet, createRootRoute, useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import posthog from "posthog-js";
import { useEffect, useRef } from "react";

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
  usePackAutoSave();
  usePostHogPageView();
  const user = useAuthStore((s) => s.currentUser);
  const sessionToken = useSessionStore((s) => s.accessToken);
  const sidebarOpen = useSidebarStore((s) => s.isOpen);
  const closeSidebar = useSidebarStore((s) => s.close);
  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
    useAuthStore.getState().hydrate(apiUrl);
  }, []);
  useEffect(() => {
    if (sessionToken) {
      useModulesStore.getState().integrate(sessionToken);
    }
  }, [sessionToken]);
  const showSidebar = !!user || !!sessionToken;
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
            {isAdminArea ? <AdminSidebar /> : <WorkspaceSidebar />}
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

export function usePackAutoSave() {
  // Subscribe whenever EITHER auth mode is live: session token (trust dance
  // via `/artisan setup`) OR signed-in user (signup/login). Previously this
  // hook only ran in session mode, so user-auth edits were silently dropped
  // (real incident on 2026-06-02 — user wrote menus that never persisted).
  const token = useSessionStore((s) => s.accessToken);
  const user = useAuthStore((s) => s.currentUser);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track which packs need saving: packId → Pack snapshot
  const pendingRef = useRef<Map<string, Pack>>(new Map());

  useEffect(() => {
    if (!token && !user) return;

    const unsubscribe = useAccountStore.subscribe((state, prev) => {
      if (state.account === prev.account) return;
      // Find changed packs
      for (const pack of state.account.packs) {
        const prevPack = prev.account.packs.find((p) => p.id === pack.id);
        if (prevPack !== pack) {
          pendingRef.current.set(pack.id, pack);
        }
      }
      // Debounce save
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        const toSave = new Map(pendingRef.current);
        pendingRef.current.clear();
        // Re-read auth state fresh — the user may have logged in / out
        // between the change and the debounce firing.
        const currentToken = useSessionStore.getState().accessToken;
        const currentUser = useAuthStore.getState().currentUser;
        if (!currentToken && !currentUser) return;
        for (const [, pack] of toSave) {
          // Silently ignore save errors — the user sees a stale "saving" indicator.
          await persistPack(pack, currentToken, !!currentUser).catch(() => {});
        }
      }, 2000);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [token, user]);
}
