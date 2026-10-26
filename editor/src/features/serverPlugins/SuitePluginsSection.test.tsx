import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SuitePluginsSection } from "./SuitePluginsSection";

const api = vi.hoisted(() => ({ fetchSuitePlugins: vi.fn() }));
vi.mock("@/lib/api/modules", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/modules")>()),
  fetchSuitePlugins: api.fetchSuitePlugins,
}));

describe("SuitePluginsSection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists each plugin with its version, jar, state and dependencies", async () => {
    api.fetchSuitePlugins.mockResolvedValue([
      { name: "Artisan", version: "1.0.42", file: "Artisan.jar", enabled: true, depends: [] },
      {
        name: "GuildQuests",
        version: "0.3",
        enabled: false,
        depends: ["MSQuests", "ArtisanGuilds"],
      },
    ]);
    render(<SuitePluginsSection serverKeyId="s1" />);
    expect(await screen.findByText("GuildQuests")).toBeInTheDocument();
    expect(screen.getByText("1.0.42")).toBeInTheDocument();
    expect(screen.getByText(/Artisan\.jar/)).toBeInTheDocument();
    expect(screen.getByText("MSQuests")).toBeInTheDocument();
    expect(screen.getAllByText(/Actif|Enabled/)).toHaveLength(1);
    expect(screen.getAllByText(/Désactivé|Disabled/)).toHaveLength(1);
    expect(api.fetchSuitePlugins).toHaveBeenCalledWith("s1");
  });

  it("asks for an update when the server lists none", async () => {
    api.fetchSuitePlugins.mockResolvedValue([]);
    render(<SuitePluginsSection serverKeyId="s1" />);
    expect(await screen.findByText(/Artisan/)).toBeInTheDocument();
  });
});
