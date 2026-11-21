import type { SiteModule, UpdateChannel } from "@/lib/api/site";

export const channelsKey = (serverId: string) => `artisan.updates.channels.${serverId}`;

/** The channel picked for each module of a server, by module id. */
export function savedChannels(serverId: string): Record<string, UpdateChannel> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(channelsKey(serverId)) ?? "{}");
    if (!saved || typeof saved !== "object") return {};
    return Object.fromEntries(
      Object.entries(saved).filter(([, value]) => value === "dev" || value === "release"),
    ) as Record<string, UpdateChannel>;
  } catch {
    return {};
  }
}

/**
 * The channel a module follows: the one picked for it, else the one its running version comes
 * from (a server already on `1.2.0-dev.4` keeps getting development builds).
 */
export function channelOf(
  picked: Record<string, UpdateChannel>,
  module: { id: string; installed: string | null },
): UpdateChannel {
  return picked[module.id] ?? (module.installed?.includes("-") ? "dev" : "release");
}

/** Each module as its own channel lists it; the stable row while the other list is not there. */
export function followedModules(
  stable: SiteModule[],
  dev: SiteModule[] | null,
  picked: Record<string, UpdateChannel>,
): SiteModule[] {
  return stable.map((m) =>
    channelOf(picked, m) === "dev" ? (dev?.find((d) => d.id === m.id) ?? m) : m,
  );
}

/**
 * The installed modules with a newer version to take: not one already downloaded or on its way,
 * which waits for a restart rather than for the admin.
 */
export function pendingUpdates(modules: SiteModule[]): number {
  return modules.filter(
    (m) => m.update && m.staged?.state !== "ready" && m.staged?.state !== "downloading",
  ).length;
}
