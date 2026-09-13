import type { Project } from "./projectStorage";
import { getInstanceCount, getMcVersion, pushResourcePackUpdated } from "../ws/hub";
import { rebuildResourcePack } from "./resourcePack";

export interface ProjectRuntime {
  readonly allowCatalogFallback: boolean;
  available(): boolean;
  minecraftVersion(): Promise<string | null>;
  afterAssetWrite(): Promise<void>;
}
class ServerRuntime implements ProjectRuntime {
  readonly allowCatalogFallback = true;
  constructor(private readonly serverId: string) {}
  available() { return getInstanceCount(this.serverId) > 0; }
  async minecraftVersion() { return await getMcVersion(this.serverId) ?? null; }
  async afterAssetWrite() { const pack = await rebuildResourcePack(this.serverId); pushResourcePackUpdated(this.serverId, pack.url, pack.hash); }
}
class HostedRuntime implements ProjectRuntime {
  readonly allowCatalogFallback = false;
  constructor(private readonly version: string | null) {}
  available() { return true; }
  async minecraftVersion() { return this.version; }
  async afterAssetWrite() {}
}
/** Runtime is selected once at the composition boundary, independent of asset logic. */
export function projectRuntime(project: Project): ProjectRuntime {
  return project.serverKeyId ? new ServerRuntime(project.serverKeyId) : new HostedRuntime(project.hostedMinecraftVersion ?? null);
}
