import { ApiError } from "@/lib/api/client";
import type { SiteModule } from "@/lib/api/site";
import { pendingUpdates } from "@/lib/updateChannels";
import {
  UPDATES_RETRY_MS,
  UPDATES_TTL_MS,
  checkUpdates,
  useUpdatesStore,
} from "@/state/updatesAvailableStore";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ listSiteModules: vi.fn() }));
vi.mock("@/lib/api/site", () => api);

const module = (over: Partial<SiteModule> = {}): SiteModule => ({
  id: "artisan",
  name: "Artisan",
  plugin: "Artisan",
  tagline: null,
  price: null,
  requires: [],
  page: null,
  installed: "1.0.0",
  access: "ok",
  latest: { version: "1.0.1", changelog: "", size: 1, published: null },
  update: true,
  staged: null,
  ...over,
});
const listing = (modules: SiteModule[]) => ({ modules, canRestart: true });

describe("updates available", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useUpdatesStore.setState({ byServer: {} });
  });

  it("counts the updates left to take, not those waiting for a restart", () => {
    expect(
      pendingUpdates([
        module(),
        module({ id: "quests", staged: { version: "1.0.1", state: "ready" } }),
        module({ id: "store", staged: { version: "1.0.1", state: "downloading" } }),
        module({ id: "lands", staged: { version: "1.0.1", state: "failed" } }),
        module({ id: "auctions", update: false }),
        module({ id: "npcs", installed: null, update: false }),
      ]),
    ).toBe(2);
  });

  it("asks the hub once per half hour, then reads the kept count", async () => {
    api.listSiteModules.mockResolvedValue(listing([module()]));
    await checkUpdates("srv");
    await checkUpdates("srv");
    expect(api.listSiteModules).toHaveBeenCalledTimes(1);
    expect(useUpdatesStore.getState().byServer.srv?.count).toBe(1);
    await checkUpdates("srv", Date.now() + UPDATES_TTL_MS + 1);
    expect(api.listSiteModules).toHaveBeenCalledTimes(2);
  });

  it("reads a module on the channel it follows", async () => {
    api.listSiteModules.mockImplementation(async (_: string, channel: string) =>
      channel === "dev"
        ? listing([module({ installed: "1.0.0-dev.3", update: true })])
        : listing([module({ installed: "1.0.0-dev.3", update: false })]),
    );
    await checkUpdates("srv");
    expect(api.listSiteModules).toHaveBeenCalledWith("srv", "dev");
    expect(useUpdatesStore.getState().byServer.srv?.count).toBe(1);
  });

  it("asks again sooner after a failure that may pass", async () => {
    api.listSiteModules.mockRejectedValue(new ApiError("server_offline", 503));
    const before = Date.now();
    await checkUpdates("srv");
    const held = useUpdatesStore.getState().byServer.srv;
    expect(held?.count).toBe(0);
    expect((held?.until ?? 0) - before).toBeLessThanOrEqual(UPDATES_RETRY_MS + 50);
  });

  it("holds an unlinked network as long as a count", async () => {
    api.listSiteModules.mockRejectedValue(new ApiError("site_not_linked", 409));
    const before = Date.now();
    await checkUpdates("srv");
    expect((useUpdatesStore.getState().byServer.srv?.until ?? 0) - before).toBeGreaterThanOrEqual(
      UPDATES_TTL_MS,
    );
  });
});
