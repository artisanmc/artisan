import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FileDiff } from "./file-diff";

describe("FileDiff", () => {
  it("explicitly reports identical contents without showing changed lines", () => {
    render(<FileDiff before={"name: Shop\n"} after={"name: Shop\n"} />);
    expect(screen.getByText(/contents are identical|contenus sont identiques/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });
  it("distinguishes a missing file from an existing empty file", () => {
    const view = render(<FileDiff before={null} after={""} />);
    expect(screen.getByText(/absent/)).toBeInTheDocument();
    expect(screen.queryByText(/contents are identical|contenus sont identiques/)).toBeNull();
    view.rerender(<FileDiff before={"name: Shop\n"} after={null} />);
    expect(
      screen.getByText(/deleted in your version|supprimé dans ta version/),
    ).toBeInTheDocument();
    expect(screen.getByText("name: Shop").closest("tr")).toHaveTextContent("−");
  });
  it("makes line-ending-only differences visible", () => {
    render(<FileDiff before={"price: 10\r\n"} after={"price: 10"} />);
    expect(screen.getByText("CRLF")).toBeInTheDocument();
    expect(screen.getByText(/No newline|Sans saut de ligne/)).toBeInTheDocument();
  });
  it("compares server lines with editor lines and preserves context and line numbers", () => {
    render(
      <FileDiff
        before={"name: Shop\nprice: 10\nactive: true\n"}
        after={"name: Shop\nprice: 20\nactive: true\n"}
      />,
    );
    const removed = screen.getByText("price: 10").closest("tr")!;
    const added = screen.getByText("price: 20").closest("tr")!;
    expect(removed).toHaveTextContent("2−price: 10");
    expect(added).toHaveTextContent("2+price: 20");
    expect(screen.getAllByText("active: true")).toHaveLength(1);
    expect(screen.getByText(/− (Server version|Version serveur)/)).toBeInTheDocument();
    expect(screen.getByText(/\+ (Your version|Ta version)/)).toBeInTheDocument();
  });
});
