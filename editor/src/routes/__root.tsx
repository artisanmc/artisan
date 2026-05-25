import { Outlet, createRootRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { transform } from "@/features/export/transform";
import { rekeyCommandLTexts, rekeyMenuLTexts } from "@/lib/i18nKeys";
import { savePack } from "@/lib/packApi";
import { useAccountStore } from "@/state/accountStore";
import { useAuthStore } from "@/state/authStore";
import { useSessionStore } from "@/state/sessionStore";
import type { Pack } from "@/domain/types";
import { ModuleSidebar } from "@/components/ModuleSidebar";

export const Route = createRootRoute({
  component: RootLayout,
});

export function RootLayout() {
  usePackAutoSave();
  const networkId = useSessionStore((s) => s.networkId);
  const user = useAuthStore((s) => s.currentUser);
  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
    useAuthStore.getState().hydrate(apiUrl);
  }, []);
  return (
    <div className="h-full flex flex-col">
      {networkId && (
        <div className="bg-zinc-800 px-4 py-1.5 text-xs text-zinc-400 border-b border-zinc-700">
          Network: <code className="text-zinc-300">{networkId}</code>
        </div>
      )}
      <div className="flex-1 flex overflow-hidden">
        {user && (
          <aside className="w-48 border-r border-zinc-800 bg-zinc-950 shrink-0">
            <ModuleSidebar />
          </aside>
        )}
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function usePackAutoSave() {
  const token = useSessionStore((s) => s.accessToken);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Track which packs need saving: packId → Pack snapshot
  const pendingRef = useRef<Map<string, Pack>>(new Map());

  useEffect(() => {
    if (!token) return;

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
        const currentToken = useSessionStore.getState().accessToken;
        if (!currentToken) return;
        for (const [, pack] of toSave) {
          try {
            const cloned = structuredClone(pack);
            for (const menu of cloned.menus) rekeyMenuLTexts(cloned, menu);
            for (const cmd of cloned.commands) rekeyCommandLTexts(cloned, cmd);
            const files = transform(cloned);
            await savePack(currentToken, pack, files);
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
  }, [token]);
}
