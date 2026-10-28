import { type Palette, type PaletteSource, builtinPaletteSource } from "@/lib/mm/palettes";
import { useEffect, useState } from "react";

const DEFAULT_SOURCES: PaletteSource[] = [builtinPaletteSource];

/**
 * Every palette the toolbar offers, from all sources merged in order. A source that
 * fails to load is skipped: the built-in palettes are always there.
 */
export function usePaletteLibrary(sources: PaletteSource[] = DEFAULT_SOURCES): Palette[] {
  const [palettes, setPalettes] = useState<Palette[]>([]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(sources.map((s) => s.load().catch(() => [] as Palette[]))).then((all) => {
      if (!cancelled) setPalettes(all.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [sources]);
  return palettes;
}
