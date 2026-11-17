import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BarList } from "./bar-list";
import { Funnel } from "./funnel";
import { SortableTable } from "./sortable-table";
import { StatCard } from "./stat-card";
import { TimeChart, niceScale } from "./time-chart";

describe("chart components", () => {
  it("rounds an axis up to three readable graduations", () => {
    expect(niceScale(0)).toEqual({ max: 1, step: 0.5 });
    expect(niceScale(7)).toEqual({ max: 10, step: 5 });
    expect(niceScale(35)).toEqual({ max: 40, step: 20 });
    expect(niceScale(480)).toEqual({ max: 500, step: 250 });
  });

  it("TimeChart names itself, shows a legend for two lines and reads a bucket from the keyboard", () => {
    render(
      <TimeChart
        label="Openings"
        series={[
          {
            id: "a",
            label: "Now",
            color: "red",
            points: [
              { label: "Mon", y: 1 },
              { label: "Tue", y: 5 },
            ],
          },
          {
            id: "b",
            label: "Before",
            color: "gray",
            dashed: true,
            points: [
              { label: "Sun", y: 2 },
              { label: "Sat", y: 3 },
            ],
          },
        ]}
      />,
    );
    const chart = screen.getByRole("img", { name: "Openings" });
    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByRole("status")).toHaveTextContent("Now · Mon");
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByRole("status")).toHaveTextContent("Now · Tue5");
    expect(screen.getByRole("status")).toHaveTextContent("Before · Sat3");
  });

  it("TimeChart with one line has no legend", () => {
    render(<TimeChart label="x" series={[{ id: "a", label: "Only", color: "red", points: [] }]} />);
    expect(screen.queryByText("Only")).toBeNull();
  });

  it("BarList scales on its largest row and opens a row", () => {
    const onSelect = vi.fn();
    const { container } = render(
      <BarList
        rows={[
          { id: "a", label: "A", value: 50 },
          { id: "b", label: "B", value: 25 },
        ]}
        onSelect={onSelect}
        selectedId="a"
      />,
    );
    const fills = [...container.querySelectorAll<HTMLElement>("[data-bar-fill]")];
    expect(fills.map((f) => f.style.width)).toEqual(["100%", "50%"]);
    fireEvent.click(screen.getByRole("button", { name: /B/ }));
    expect(onSelect).toHaveBeenCalledWith("b");
    expect(screen.getByRole("button", { name: /A/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("Funnel writes each step's share of the first and what was lost since the step before", () => {
    const { container } = render(
      <Funnel
        formatShare={(r) => `${Math.round(r * 100)}%`}
        steps={[
          { id: "a", label: "Joined", value: 200 },
          { id: "b", label: "Done", value: 50 },
        ]}
      />,
    );
    const fills = [...container.querySelectorAll<HTMLElement>("[data-funnel-fill]")];
    expect(fills.map((f) => f.style.width)).toEqual(["100%", "25%"]);
    expect(screen.getByText("−75%")).toBeInTheDocument();
  });

  it("SortableTable sorts by a column, reverses on a second click and opens a row", () => {
    const onSelect = vi.fn();
    render(
      <SortableTable
        rows={[
          { name: "b", n: 1 },
          { name: "a", n: 9 },
          { name: "c", n: 5 },
        ]}
        rowId={(r) => r.name}
        initialSort="n"
        onSelect={onSelect}
        columns={[
          { id: "name", label: "Name", value: (r) => r.name },
          { id: "n", label: "Count", value: (r) => r.n, align: "right" },
        ]}
      />,
    );
    const names = () =>
      screen
        .getAllByRole("row")
        .slice(1)
        .map((r) => r.textContent?.[0]);
    expect(names()).toEqual(["a", "c", "b"]);
    fireEvent.click(screen.getByRole("button", { name: "Count" }));
    expect(names()).toEqual(["b", "c", "a"]);
    fireEvent.click(screen.getByRole("button", { name: "Name" }));
    expect(names()).toEqual(["a", "b", "c"]);
    fireEvent.click(screen.getByRole("button", { name: "c" }));
    expect(onSelect).toHaveBeenCalledWith("c");
  });

  it("StatCard shows a trend with its tone", () => {
    const { container } = render(
      <StatCard label="x" value="1" trend={{ label: "▲ +5%", tone: "positive" }} />,
    );
    expect(container.querySelector("[data-trend]")?.className).toContain("--success");
  });
});
