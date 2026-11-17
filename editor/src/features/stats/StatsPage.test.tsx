import { ApiError } from "@/lib/api/client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StatsPage } from "./StatsPage";

const api = vi.hoisted(() => ({
  fetchStatsCatalog: vi.fn(),
  fetchStatsSeries: vi.fn(),
  fetchStatsBreakdown: vi.fn(),
  fetchStatsActives: vi.fn(),
  fetchStatsEvents: vi.fn(),
  searchStatsPlayers: vi.fn(),
  fetchStatsPlayerNames: vi.fn(),
}));
vi.mock("@/lib/api/stats", () => api);
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, o?: Record<string, unknown>) =>
      o && "command" in o ? `${key}:${o.command}` : key,
    i18n: { language: "en" },
  }),
}));

const now = new Date("2026-11-16T16:42:09Z");
const known = {
  commands: ["shop", "warp"],
  menus: [{ ref: "shop:main", elements: ["buy", "sell"] }],
};
const point = (start: number, count: number, sum = count) => ({
  start,
  granularity: "day" as const,
  count,
  sum,
  min: 0,
  max: sum,
});

beforeEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  api.fetchStatsCatalog.mockResolvedValue([]);
  api.fetchStatsSeries.mockResolvedValue([point(0, 2, 7200), point(86400, 1, 600)]);
  api.fetchStatsActives.mockResolvedValue({ players: 12, points: [{ start: 0, players: 12 }] });
  api.fetchStatsBreakdown.mockResolvedValue([]);
  api.fetchStatsEvents.mockResolvedValue({ events: [], next: null });
  api.fetchStatsPlayerNames.mockResolvedValue([]);
  api.searchStatsPlayers.mockResolvedValue([]);
});

describe("StatsPage", () => {
  it("shows who plays over the last 7 days, compared with the 7 before", async () => {
    render(<StatsPage serverId="srv" search={{}} onSearch={vi.fn()} known={known} now={now} />);
    expect(await screen.findByText("12")).toBeInTheDocument();
    // 3 visits, 7800 s of play.
    expect(screen.getByText("2 h 10")).toBeInTheDocument();
    const to = Date.parse("2026-11-16T17:00:00Z") / 1000;
    const calls = api.fetchStatsActives.mock.calls.map(([, q, by]) => [q.event, q.from, q.to, by]);
    expect(calls).toEqual([
      ["core:session", to - 7 * 86400, to, "day"],
      ["core:session", to - 14 * 86400, to - 7 * 86400, "day"],
    ]);
  });

  it("reads one period only when the comparison is off, and one player when one is picked", async () => {
    const player = "00000000-0000-0000-0000-00000000000a";
    render(
      <StatsPage
        serverId="srv"
        search={{ compare: false, player, range: "24h" }}
        onSearch={vi.fn()}
        known={known}
        now={now}
      />,
    );
    await screen.findByText("stats.overview.lastSessions");
    expect(api.fetchStatsActives).toHaveBeenCalledTimes(1);
    expect(api.fetchStatsActives.mock.calls[0]?.[1].player).toBe(player);
    expect(api.fetchStatsActives.mock.calls[0]?.[2]).toBe("hour");
    expect(screen.queryByText("stats.overview.activePlayers")).toBeNull();
  });

  it("lists the commands with their refusals, and those never run", async () => {
    api.fetchStatsBreakdown.mockImplementation(async (_s, q) =>
      q.dims?.result === "ok"
        ? [{ value: "shop", count: 6, sum: 6, min: 1, max: 1 }]
        : [{ value: "shop", count: 8, sum: 8, min: 1, max: 1 }],
    );
    const onSearch = vi.fn();
    render(
      <StatsPage
        serverId="srv"
        search={{ tab: "commands" }}
        onSearch={onSearch}
        known={known}
        now={now}
      />,
    );
    const row = (await screen.findByRole("button", { name: "/shop" })).closest("tr");
    expect(row?.textContent).toBe("/shop8225%");
    expect(screen.getByText("/warp")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "/shop" }));
    expect(onSearch).toHaveBeenCalledWith({ focus: "shop" });
  });

  it("drills into a menu: its clicked elements and those nobody clicked", async () => {
    api.fetchStatsBreakdown.mockImplementation(async (_s, q, dim) =>
      dim === "element"
        ? [{ value: "buy", count: 4, sum: 4, min: 1, max: 1 }]
        : [
            {
              value: "shop:main",
              count: q.event === "core:menu_open" ? 10 : 4,
              sum: 0,
              min: 0,
              max: 0,
            },
          ],
    );
    render(
      <StatsPage
        serverId="srv"
        search={{ tab: "menus", focus: "shop:main" }}
        onSearch={vi.fn()}
        known={known}
        now={now}
      />,
    );
    expect(await screen.findByText("sell")).toBeInTheDocument();
    expect(screen.getByText("buy")).toBeInTheDocument();
    const elementCall = api.fetchStatsBreakdown.mock.calls.find(([, , dim]) => dim === "element");
    expect(elementCall?.[1].dims).toEqual({ menu: "shop:main" });
  });

  it("changes tab and period through the URL", async () => {
    const onSearch = vi.fn();
    render(<StatsPage serverId="srv" search={{}} onSearch={onSearch} known={known} now={now} />);
    await screen.findByText("12");
    fireEvent.click(screen.getByRole("button", { name: "stats.tabs.menus" }));
    expect(onSearch).toHaveBeenCalledWith({ tab: "menus", focus: undefined });
    fireEvent.click(screen.getByRole("button", { name: "stats.period.30d" }));
    expect(onSearch).toHaveBeenCalledWith({ range: "30d", from: undefined, to: undefined });
  });

  it("says so when statistics are turned off", async () => {
    api.fetchStatsCatalog.mockRejectedValue(new ApiError("stats_disabled", 404));
    render(<StatsPage serverId="srv" search={{}} onSearch={vi.fn()} known={known} now={now} />);
    await waitFor(() => expect(screen.getByText("stats.disabled")).toBeInTheDocument());
  });
});
