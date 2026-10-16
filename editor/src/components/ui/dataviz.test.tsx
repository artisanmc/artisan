import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HBar } from "./h-bar";
import { StatCard } from "./stat-card";
import { TBody, TD, TH, THead, TR, Table } from "./table";

describe("dataviz primitives", () => {
  it("StatCard renders label, value, negative tone class", () => {
    render(<StatCard label="Marge" value="-$0.50" tone="negative" />);
    expect(screen.getByText("Marge")).toBeInTheDocument();
    const v = screen.getByText("-$0.50");
    expect(v.className).toContain("--danger");
  });

  it("HBar clamps width to 0 when max is 0", () => {
    const { container } = render(<HBar label="x" value={5} max={0} />);
    const fill = container.querySelector("[data-bar-fill]") as HTMLElement;
    expect(fill.style.width).toBe("0%");
  });

  it("HBar computes percentage width", () => {
    const { container } = render(<HBar label="x" value={25} max={100} />);
    const fill = container.querySelector("[data-bar-fill]") as HTMLElement;
    expect(fill.style.width).toBe("25%");
  });

  it("Table renders rows", () => {
    render(
      <Table>
        <THead>
          <TR>
            <TH>Col</TH>
          </TR>
        </THead>
        <TBody>
          <TR>
            <TD>Val</TD>
          </TR>
        </TBody>
      </Table>,
    );
    expect(screen.getByText("Col")).toBeInTheDocument();
    expect(screen.getByText("Val")).toBeInTheDocument();
  });
});
