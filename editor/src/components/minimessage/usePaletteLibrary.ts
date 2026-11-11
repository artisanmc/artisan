import { getServerConfig } from "@/lib/api/serverConfig";
import {
  type Palette,
  type PaletteSource,
  builtinPaletteSource,
  serverPaletteFromConfig,
} from "@/lib/mm/palettes";
import { useServersStore } from "@/state/serversStore";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/** One request per server while the page lives; dropped when the palette is saved. */
const configs = new Map<string, Promise<Record<string, unknown> | null>>();

const serverConfigOf = (serverId: string) => {
  let pending = configs.get(serverId);
  if (!pending) {
    pending = getServerConfig(serverId)
      .then((res) => res.config)
      .catch(() => null);
    configs.set(serverId, pending);
  }
  return pending;
};

/** After a server's palette is written: the next editor asks again. */
export function invalidateServerPalette(): void {
  configs.clear();
}

/** The server's palette (`text-palette` of its `config.yml`), offered first. */
function serverPaletteSource(serverId: string, name: string): PaletteSource {
  return {
    id: `server:${serverId}`,
    labelKey: "mmEditor.palettes.server",
    writable: false,
    load: async () => {
      const palette = serverPaletteFromConfig(await serverConfigOf(serverId), name);
      return palette ? [palette] : [];
    },
  };
}

/**
 * Every palette the toolbar offers, from all sources merged in order: the active
 * server's, then the built-in ones. A source that fails to load is skipped: the
 * built-in palettes are always there.
 */
export function usePaletteLibrary(sources?: PaletteSource[]): Palette[] {
  const { t } = useTranslation();
  const serverId = useServersStore((s) => s.activeServerId);
  const name = t("mmEditor.palettes.server");
  const all = useMemo(
    () =>
      sources ??
      (serverId
        ? [serverPaletteSource(serverId, name), builtinPaletteSource]
        : [builtinPaletteSource]),
    [sources, serverId, name],
  );
  const [palettes, setPalettes] = useState<Palette[]>([]);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(all.map((s) => s.load().catch(() => [] as Palette[]))).then((loaded) => {
      if (!cancelled) setPalettes(loaded.flat());
    });
    return () => {
      cancelled = true;
    };
  }, [all]);
  return palettes;
}
