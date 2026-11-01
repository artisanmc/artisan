/**
 * The player the Play mode plays as (spec "Mode Jeu", decisions 2026-10-29): what the
 * preview cannot know without a server, set by hand. Conditions read it, placeholders
 * resolve from it, and a condition the preview cannot evaluate takes its forced value.
 */
export interface TestPlayer {
  name: string;
  /** An operator has every permission. */
  op: boolean;
  /** Granted nodes; `shop.*` grants every node under `shop.`. */
  permissions: string[];
  money: number;
  /** Experience points, and the level. */
  xp: number;
  level: number;
  world: string;
  /** The client played on (`client_is`); absent: Java. */
  client?: "java" | "bedrock";
  /** Whether the client loaded the server's pack (`has_resource_pack`); absent: no. */
  hasPack?: boolean;
  /** PlaceholderAPI values by name, without the `%`: `vault_eco_balance` → `1200`. */
  placeholders: Record<string, string>;
  /** The value of each condition the preview cannot evaluate, by `conditionKey`; absent: true. */
  forced: Record<string, boolean>;
}

export const DEFAULT_TEST_PLAYER: TestPlayer = {
  name: "Steve",
  op: false,
  permissions: [],
  money: 1000,
  xp: 0,
  level: 0,
  world: "world",
  placeholders: {},
  forced: {},
};

/** Whether the player holds `node`: an operator, the node itself, or a `prefix.*` above it. */
export function hasPermission(player: TestPlayer, node: string): boolean {
  if (!node || player.op) return true;
  return player.permissions.some(
    (p) => p === node || p === "*" || (p.endsWith(".*") && node.startsWith(p.slice(0, -1))),
  );
}

/** The placeholders every server has (PlaceholderAPI's player and Vault expansions), from the player. */
export function builtinPlaceholders(player: TestPlayer): Record<string, string> {
  return {
    player_name: player.name,
    player_displayname: player.name,
    player_world: player.world,
    player_level: String(player.level),
    player_total_exp: String(player.xp),
    vault_eco_balance: String(player.money),
    vault_eco_balance_fixed: String(Math.floor(player.money)),
  };
}

const storageKey = (serverId: string) => `artisan.play.player.${serverId}`;

/** The test player saved for a server in this browser, or the default one. */
export function loadTestPlayer(serverId: string): TestPlayer {
  try {
    const raw = localStorage.getItem(storageKey(serverId));
    if (!raw) return DEFAULT_TEST_PLAYER;
    return { ...DEFAULT_TEST_PLAYER, ...(JSON.parse(raw) as Partial<TestPlayer>) };
  } catch {
    return DEFAULT_TEST_PLAYER;
  }
}

export function saveTestPlayer(serverId: string, player: TestPlayer): void {
  try {
    localStorage.setItem(storageKey(serverId), JSON.stringify(player));
  } catch {
    // Private window or blocked storage: the player lasts for the session only.
  }
}
