import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FileDiff, diffStats } from "./file-diff";

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

describe("FileDiff — git-style hunks", () => {
  const lines = (n: number, changed?: number) =>
    Array.from(
      { length: n },
      (_, i) => `line ${i + 1}${i + 1 === changed ? " edited" : ""}\n`,
    ).join("");
  it("folds long unchanged runs and keeps three lines of context around a change", () => {
    render(<FileDiff before={lines(20)} after={lines(20, 10)} />);
    expect(screen.queryByText("line 6")).toBeNull();
    expect(screen.getByText("line 7")).toBeInTheDocument();
    expect(screen.getByText("line 13")).toBeInTheDocument();
    expect(screen.queryByText("line 14")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /6 unchanged lines|6 lignes inchangées/ }));
    expect(screen.getByText("line 1")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /7 unchanged lines|7 lignes inchangées/ }),
    ).toBeInTheDocument();
  });
  it("names both sides with the labels it is given", () => {
    render(<FileDiff before={"a\n"} after={"b\n"} beforeLabel="Serveur" afterLabel="Brouillon" />);
    expect(screen.getByText("− Serveur")).toBeInTheDocument();
    expect(screen.getByText("+ Brouillon")).toBeInTheDocument();
  });
  it("counts added and removed lines", () => {
    expect(diffStats("a\nb\nc\n", "a\nB\nc\nd\n")).toEqual({ added: 2, removed: 1 });
    expect(diffStats(null, "a\nb\n")).toEqual({ added: 2, removed: 0 });
    expect(diffStats("a\n", null)).toEqual({ added: 0, removed: 1 });
  });
});
