import type { LText, PackId } from "@/domain/types";
import { getText } from "@/lib/i18n";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { useCallback } from "react";

/**
 * React bridge for `getText`. Subscribes to the pack ref (immer keeps it
 * stable across unrelated edits) and the active language so the value
 * re-renders when either changes.
 *
 * For components that resolve many `LText` refs in one render, prefer
 * `useGetText` below — it returns a stable resolver and avoids one
 * subscription per call.
 */
export function useText(packId: PackId, lt: LText | undefined): string {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const activeLang = useUiStore((s) => s.activeLang);
  if (!pack || !lt) return "";
  return getText(pack, lt, activeLang);
}

export function useGetText(packId: PackId): (lt: LText | undefined) => string {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const activeLang = useUiStore((s) => s.activeLang);
  return useCallback(
    (lt) => (pack && lt ? getText(pack, lt, activeLang) : ""),
    [pack, activeLang],
  );
}

/**
 * Resolved text + active language for callers that also need to dispatch
 * a write back through the appropriate store mutator. Saves a duplicate
 * `useUiStore` subscription at the call site.
 */
export function useTextEdit(
  packId: PackId,
  lt: LText | undefined,
): { value: string; lang: string; isFallback: boolean } {
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const activeLang = useUiStore((s) => s.activeLang);
  if (!pack || !lt) return { value: "", lang: activeLang, isFallback: false };
  const entry = pack.i18nKeys[lt.key];
  const direct = entry?.[activeLang];
  if (direct !== undefined) return { value: direct, lang: activeLang, isFallback: false };
  const fallback = entry?.[pack.defaultLang] ?? "";
  return { value: fallback, lang: activeLang, isFallback: fallback !== "" };
}
