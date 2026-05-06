import { Outlet, createRootRoute } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { transform } from "@/features/export/transform";
import { rekeyCommandLTexts, rekeyMenuLTexts } from "@/lib/i18nKeys";
import { savePack } from "@/lib/packApi";
import { useAccountStore } from "@/state/accountStore";
import { useSessionStore } from "@/state/sessionStore";
import type { Pack } from "@/domain/types";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  usePackAutoSave();
  return (
    <div className="h-full">
      <Outlet />
    </div>
  );
}

function usePackAutoSave() {
  const token = useSessionStore((s) => s.token);
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
        const currentToken = useSessionStore.getState().token;
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
