import { ApiError } from "@/lib/api/client";
import type { SiteLinkStatus, SiteModule } from "@/lib/api/site";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "i18next";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerModulesTab, channelOf } from "./ServerModulesTab";

const api = vi.hoisted(() => ({
  getSiteLink: vi.fn(),
  startSiteLink: vi.fn(),
  removeSiteLink: vi.fn(),
  listSiteModules: vi.fn(),
  installSiteModule: vi.fn(),
  restartServer: vi.fn(),
}));
vi.mock("@/lib/api/site", () => api);

const link = (over: Partial<SiteLinkStatus> = {}): SiteLinkStatus => ({
  site: "https://artisanmc.net",
  linked: false,
  name: null,
  linkedAt: null,
  canManage: true,
  pending: null,
  ...over,
});

/** What the hub answers for a channel; the server knows how to restart. */
const listing = (modules: SiteModule[], canRestart = true) => ({ modules, canRestart });

const module = (over: Partial<SiteModule> = {}): SiteModule => ({
  id: "artisan",
  name: "Artisan",
  plugin: "Artisan",
  tagline: { en: "The editor", fr: "L'éditeur" },
  price: null,
  requires: [],
  page: "https://artisanmc.net/modules/artisan/versions/",
  installed: "1.0.0",
  access: "ok",
  latest: { version: "1.0.1", changelog: "- Fixes", size: 2048, published: null },
  update: true,
  staged: null,
  ...over,
});

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

describe("server updates tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it("shows the code to approve on the site, never a token", async () => {
    api.getSiteLink.mockResolvedValue(link());
    api.startSiteLink.mockResolvedValue(
      link({
        pending: {
          userCode: "ABCD-EFGH",
          verificationUrl: "https://artisanmc.net/link/?code=ABCD-EFGH",
          expiresAt: "2026-11-18T08:10:00Z",
        },
      }),
    );
    render(<ServerModulesTab serverId="srv" />);
    fireEvent.click(await screen.findByRole("button", { name: "Link to my account" }));
    expect(await screen.findByTestId("link-code")).toHaveTextContent("ABCD-EFGH");
    expect(screen.getByRole("link", { name: "Open artisanmc.net" })).toHaveAttribute(
      "href",
      "https://artisanmc.net/link/?code=ABCD-EFGH",
    );
    expect(api.listSiteModules).not.toHaveBeenCalled();
  });

  it("leaves linking to those who may configure", async () => {
    api.getSiteLink.mockResolvedValue(link({ canManage: false }));
    render(<ServerModulesTab serverId="srv" />);
    expect(await screen.findByText(/Ask someone who may configure/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Link to my account" })).toBeNull();
  });

  it("updates an installed module and installs an owned one, on the chosen channel", async () => {
    api.getSiteLink.mockResolvedValue(link({ linked: true, name: "survie" }));
    api.listSiteModules.mockResolvedValue(
      listing([
        module(),
        module({
          id: "store",
          name: "Store",
          plugin: "ArtisanStore",
          installed: null,
          update: false,
          requires: ["artisan"],
          latest: { version: "2.0.0", changelog: "", size: 10, published: null },
        }),
        module({
          id: "quests",
          name: "Quests",
          plugin: "ArtisanQuests",
          installed: null,
          update: false,
          access: "licence",
          price: { amount: 1000, currency: "eur" },
          page: "https://artisanmc.net/modules/quests/versions/",
        }),
      ]),
    );
    api.installSiteModule.mockResolvedValue(undefined);
    render(<ServerModulesTab serverId="srv" />);

    const artisan = within(await screen.findByTestId("module-artisan"));
    fireEvent.click(artisan.getByRole("button", { name: "Update to 1.0.1" }));
    await waitFor(() =>
      expect(api.installSiteModule).toHaveBeenCalledWith("srv", "artisan", "release"),
    );

    const store = within(screen.getByTestId("module-store"));
    expect(store.getByRole("button", { name: "Install 2.0.0" })).toBeEnabled();

    // Not owned: a way to the site, no install.
    const quests = within(screen.getByTestId("module-quests"));
    expect(quests.queryByRole("button", { name: /Update|Install|Try again/ })).toBeNull();
    expect(quests.getByRole("link", { name: "See on the site" })).toHaveAttribute(
      "href",
      "https://artisanmc.net/modules/quests/",
    );
    // Every module's name leads to its page, and the list to the whole catalogue.
    expect(store.getByRole("link", { name: "Store" })).toHaveAttribute(
      "href",
      "https://artisanmc.net/modules/store/",
    );
    expect(
      screen.getByRole("link", { name: "The whole catalogue on artisanmc.net" }),
    ).toHaveAttribute("href", "https://artisanmc.net/modules/");

    // The channel is picked module by module: Store follows development builds, Artisan does not.
    expect(api.listSiteModules).not.toHaveBeenCalledWith("srv", "dev");
    fireEvent.click(store.getByRole("button", { name: "Dev" }));
    await waitFor(() => expect(api.listSiteModules).toHaveBeenCalledWith("srv", "dev"));
    expect(localStorage.getItem("artisan.updates.channels.srv")).toBe('{"store":"dev"}');
    fireEvent.click(store.getByRole("button", { name: "Install 2.0.0" }));
    await waitFor(() =>
      expect(api.installSiteModule).toHaveBeenLastCalledWith("srv", "store", "dev"),
    );
    fireEvent.click(artisan.getByRole("button", { name: "Update to 1.0.1" }));
    await waitFor(() =>
      expect(api.installSiteModule).toHaveBeenLastCalledWith("srv", "artisan", "release"),
    );
  });

  it("keeps a server on the channel its version comes from, until one is picked", () => {
    expect(channelOf({}, { id: "store", installed: "1.0.0" })).toBe("release");
    expect(channelOf({}, { id: "store", installed: "1.0.1-dev.4" })).toBe("dev");
    expect(channelOf({}, { id: "store", installed: null })).toBe("release");
    expect(channelOf({ store: "release" }, { id: "store", installed: "1.0.1-dev.4" })).toBe(
      "release",
    );
  });

  it("says what waits for a restart and why a download failed", async () => {
    api.getSiteLink.mockResolvedValue(link({ linked: true, name: "survie" }));
    api.listSiteModules.mockResolvedValue(
      listing([
        module({ staged: { version: "1.0.1", state: "ready" } }),
        module({
          id: "store",
          name: "Store",
          installed: "1.9.0",
          latest: { version: "2.0.0", changelog: "", size: 10, published: null },
          staged: { version: "2.0.0", state: "failed", error: "hash_mismatch" },
        }),
      ]),
    );
    render(<ServerModulesTab serverId="srv" />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Restart the server to load Artisan 1.0.1.",
    );
    const artisan = within(screen.getByTestId("module-artisan"));
    expect(artisan.queryByRole("button", { name: /Update|Install|Try again/ })).toBeNull();
    const store = within(screen.getByTestId("module-store"));
    expect(store.getByText(/2.0.0 was not installed: the file did not match/)).toBeInTheDocument();
    expect(store.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("sends to the Supporter plan for a development build kept for Supporters", async () => {
    api.getSiteLink.mockResolvedValue(link({ linked: true, name: "survie" }));
    api.listSiteModules.mockResolvedValue(
      listing([
        module({
          id: "store",
          name: "Store",
          installed: "1.9.0",
          update: true,
          access: "supporter",
          latest: { version: "2.0.0-dev.3", changelog: "", size: 10, published: null },
          page: "https://artisanmc.net/supporter/",
        }),
      ]),
    );
    render(<ServerModulesTab serverId="srv" />);
    const store = within(await screen.findByTestId("module-store"));
    expect(store.getByText("Supporters only")).toBeInTheDocument();
    expect(store.queryByRole("button", { name: /Update|Install/ })).toBeNull();
    expect(store.getByRole("link", { name: "See the Supporter plan" })).toHaveAttribute(
      "href",
      "https://artisanmc.net/supporter/",
    );
  });

  it("restarts the server once confirmed, and only where its plugin can", async () => {
    api.getSiteLink.mockResolvedValue(link({ linked: true, name: "survie" }));
    api.listSiteModules.mockResolvedValue(
      listing([module({ staged: { version: "1.0.1", state: "ready" } })]),
    );
    api.restartServer.mockResolvedValue(10);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValue(true);
    const { unmount } = render(<ServerModulesTab serverId="srv" />);

    const button = await screen.findByRole("button", { name: "Restart the server" });
    fireEvent.click(button);
    expect(api.restartServer).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(api.restartServer).toHaveBeenCalledWith("srv"));
    expect(await screen.findByText(/restarts in 10 seconds/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Restart the server" })).toBeNull();
    unmount();
    confirm.mockRestore();

    // A plugin on an older release has no restart to ask for.
    api.listSiteModules.mockResolvedValue(listing([module()], false));
    render(<ServerModulesTab serverId="srv" />);
    await screen.findByText("Artisan");
    expect(screen.queryByRole("button", { name: "Restart the server" })).toBeNull();
  });

  it("offers nothing to install without the right to configure", async () => {
    api.getSiteLink.mockResolvedValue(link({ linked: true, name: "survie", canManage: false }));
    api.listSiteModules.mockResolvedValue(listing([module()]));
    render(<ServerModulesTab serverId="srv" />);
    const artisan = within(await screen.findByTestId("module-artisan"));
    expect(artisan.queryByRole("button", { name: /Update|Install|Try again/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unlink" })).toBeNull();
  });

  it("goes back to linking when the site refuses the token", async () => {
    api.getSiteLink
      .mockResolvedValueOnce(link({ linked: true, name: "survie" }))
      .mockResolvedValue(link());
    api.listSiteModules.mockRejectedValue(new ApiError("site_not_linked", 409));
    render(<ServerModulesTab serverId="srv" />);
    expect(await screen.findByRole("button", { name: "Link to my account" })).toBeInTheDocument();
  });
});
