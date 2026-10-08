import type { GuiContainer } from "./vanillaGui";

/**
 * Editable `config.yml` of each connected server, as its plugin last reported
 * it (hello, then each accepted write). The file on the server is the truth;
 * this is only what the editor shows and what the pack build reads
 * (ADR `server-config-from-editor`). Absent = plugin too old to report it.
 */
const configs = new Map<string, Record<string, unknown>>();

export function serverConfig(serverKeyId: string): Record<string, unknown> | null {
  return configs.get(serverKeyId) ?? null;
}

/** `projet:image` per container, from `resource-pack.container-textures.*`; blank = vanilla. */
export function containerTextureRefs(serverKeyId: string): Record<GuiContainer, string | undefined> {
  const config = configs.get(serverKeyId);
  const ref = (c: GuiContainer) => {
    const value = config?.[`resource-pack.container-textures.${c}`];
    return typeof value === "string" && value.includes(":") ? value : undefined;
  };
  return { chest: ref("chest"), hopper: ref("hopper"), dispenser: ref("dispenser") };
}

/** Records a report; true when the container textures changed (the pack must follow). */
export function recordServerConfig(serverKeyId: string, config: unknown): boolean {
  const before = JSON.stringify(containerTextureRefs(serverKeyId));
  if (config && typeof config === "object" && !Array.isArray(config)) configs.set(serverKeyId, config as Record<string, unknown>);
  else configs.delete(serverKeyId);
  return JSON.stringify(containerTextureRefs(serverKeyId)) !== before;
}
