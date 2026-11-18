import { ApiError } from "@/lib/api/client";
import type { SiteLinkStatus, SiteModule } from "@/lib/api/site";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import i18n from "i18next";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ServerModulesTab } from "./ServerModulesTab";

const api = vi.hoisted(() => ({
  getSiteLink: vi.fn(),
  startSiteLink: vi.fn(),
  removeSiteLink: vi.fn(),
  listSiteModules: vi.fn(),
  installSiteModule: vi.fn(),
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
    api.listSiteModules.mockResolvedValue([
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
    ]);
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
    expect(quests.queryByRole("button")).toBeNull();
    expect(quests.getByRole("link", { name: "See on the site" })).toHaveAttribute(
      "href",
      "https://artisanmc.net/modules/quests/versions/",
    );

    fireEvent.click(screen.getByRole("button", { name: "Development builds" }));
    await waitFor(() => expect(api.listSiteModules).toHaveBeenLastCalledWith("srv", "dev"));
    expect(localStorage.getItem("artisan.updates.channel.srv")).toBe("dev");
  });

  it("says what waits for a restart and why a download failed", async () => {
    api.getSiteLink.mockResolvedValue(link({ linked: true, name: "survie" }));
    api.listSiteModules.mockResolvedValue([
      module({ staged: { version: "1.0.1", state: "ready" } }),
      module({
        id: "store",
        name: "Store",
        installed: "1.9.0",
        latest: { version: "2.0.0", changelog: "", size: 10, published: null },
        staged: { version: "2.0.0", state: "failed", error: "hash_mismatch" },
      }),
    ]);
    render(<ServerModulesTab serverId="srv" />);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Restart the server to load Artisan 1.0.1.",
    );
    const artisan = within(screen.getByTestId("module-artisan"));
    expect(artisan.queryByRole("button")).toBeNull();
    const store = within(screen.getByTestId("module-store"));
    expect(store.getByText(/2.0.0 was not installed: the file did not match/)).toBeInTheDocument();
    expect(store.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("sends to the Supporter plan for a development build kept for Supporters", async () => {
    api.getSiteLink.mockResolvedValue(link({ linked: true, name: "survie" }));
    api.listSiteModules.mockResolvedValue([
      module({
        id: "store",
        name: "Store",
        installed: "1.9.0",
        update: true,
        access: "supporter",
        latest: { version: "2.0.0-dev.3", changelog: "", size: 10, published: null },
        page: "https://artisanmc.net/supporter/",
      }),
    ]);
    render(<ServerModulesTab serverId="srv" />);
    const store = within(await screen.findByTestId("module-store"));
    expect(store.getByText("Supporters only")).toBeInTheDocument();
    expect(store.queryByRole("button", { name: /Update|Install/ })).toBeNull();
    expect(store.getByRole("link", { name: "See the Supporter plan" })).toHaveAttribute(
      "href",
      "https://artisanmc.net/supporter/",
    );
  });

  it("offers nothing to install without the right to configure", async () => {
    api.getSiteLink.mockResolvedValue(link({ linked: true, name: "survie", canManage: false }));
    api.listSiteModules.mockResolvedValue([module()]);
    render(<ServerModulesTab serverId="srv" />);
    const artisan = within(await screen.findByTestId("module-artisan"));
    expect(artisan.queryByRole("button")).toBeNull();
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
