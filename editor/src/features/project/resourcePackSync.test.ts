// @vitest-environment jsdom

import type { TFunction } from "i18next";
import { beforeEach, describe, expect, test, vi } from "vitest";

const rebuild = vi.fn<(serverId: string) => Promise<string | null>>();
const config = vi.fn();
const toast = vi.hoisted(() => ({ info: vi.fn(), warning: vi.fn(), error: vi.fn() }));

vi.mock("@/lib/pack/buildServerPack", () => ({
  requestResourcePackRebuild: (id: string) => rebuild(id),
}));
vi.mock("@/lib/api/serverConfig", () => ({ getServerConfig: (id: string) => config(id) }));
vi.mock("sonner", () => ({ toast }));

import { rebuildServerPackInBackground } from "./resourcePackSync";

const t = ((key: string) => key) as unknown as TFunction;
const SERVER = "srv";
const NEXO = "plugins/Nexo/pack/external_packs/artisan.zip";

/** Runs one rebuild answering [hash] and waits for its toasts. */
async function deploy(hash: string | null) {
  rebuild.mockResolvedValueOnce(hash);
  rebuildServerPackInBackground(t, SERVER);
  await vi.waitFor(() => expect(rebuild).toHaveBeenCalled());
  await new Promise((done) => setTimeout(done, 0));
  rebuild.mockClear();
}

const delegated = (command: string) => ({
  online: true,
  config: {
    "resource-pack.delegate-to-dir": NEXO,
    "resource-pack.delegate-reload-command": command,
  },
});

describe("rebuildServerPackInBackground", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test("the first pack seen and an unchanged pack say nothing", async () => {
    config.mockResolvedValue(delegated(""));
    await deploy("a");
    await deploy("a");
    await deploy(null);
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
  });

  test("a changed pack without a reload command warns", async () => {
    config.mockResolvedValue(delegated("  "));
    await deploy("a");
    await deploy("b");
    expect(toast.warning).toHaveBeenCalledWith(
      "deploy.packChanged",
      expect.objectContaining({ description: "deploy.packChangedNoReload" }),
    );
    expect(toast.info).not.toHaveBeenCalled();
  });

  test("a changed pack with a reload command informs", async () => {
    config.mockResolvedValue(delegated("nexo reload pack"));
    await deploy("a");
    await deploy("b");
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.warning).not.toHaveBeenCalled();
  });

  test("a pack Artisan sends itself, or a server whose config is unknown, says nothing", async () => {
    config.mockResolvedValue({ online: true, config: { "resource-pack.delegate-to-dir": "" } });
    await deploy("a");
    await deploy("b");
    config.mockResolvedValue({ online: false, config: null });
    await deploy("c");
    config.mockRejectedValue(new Error("offline"));
    await deploy("d");
    expect(toast.info).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
