import { Outlet, createRootRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { transform } from "@/features/export/transform";
import { rekeyCommandLTexts, rekeyMenuLTexts } from "@/lib/i18nKeys";
import { savePack } from "@/lib/packApi";
import { saveUserPack } from "@/lib/api/userPacks";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useSessionStore } from "@/state/sessionStore";
import type { Pack } from "@/domain/types";
import { WorkspaceSidebar } from "@/components/WorkspaceSidebar";

export const Route = createRootRoute({
  component: RootLayout,
});

export function RootLayout() {
  usePackAutoSave();
  const user = useAuthStore((s) => s.currentUser);
  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
    useAuthStore.getState().hydrate(apiUrl);
  }, []);
  return (
    <div className="flex h-full">
      {user && (
        <aside className="w-[216px] shrink-0 border-r border-[var(--line-soft)] bg-[var(--bg-deep)]">
          <WorkspaceSidebar />
        </aside>
      )}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
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
          try {
            const cloned = structuredClone(pack);
            for (const menu of cloned.menus) rekeyMenuLTexts(cloned, menu);
            for (const cmd of cloned.commands) rekeyCommandLTexts(cloned, cmd);
            const files = transform(cloned);
            if (currentToken) {
              // Session mode (trust dance): persist via the session-scoped
              // endpoint that the editor_session token authorises.
              await savePack(currentToken, pack, files);
            } else {
              // User-auth mode: cookie-based call to the user-scoped pack
              // endpoint. Membership of the network is checked server-side.
              await saveUserPack(pack.id, { hash: "", files, editor: pack });
            }
          } catch {
            // silently ignore save errors — user will see stale "saving" indicator
          }
        }
      }, 2000);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [token, user]);
}
