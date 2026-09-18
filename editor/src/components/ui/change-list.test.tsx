import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChangeList, listChanges } from "./change-list";

describe("listChanges", () => {
  it("classifies added, deleted and modified files, sorted by path", () => {
    const changes = listChanges({
      before: { "b.yaml": "x\n", "c.yaml": "same\n", "d.yaml": "gone\n" },
      after: { "a.yaml": "new\n", "b.yaml": "y\n", "c.yaml": "same\n" },
    });
    expect(changes.map((c) => [c.path, c.status, c.added, c.removed])).toEqual([
      ["a.yaml", "added", 1, 0],
      ["b.yaml", "modified", 1, 1],
      ["d.yaml", "deleted", 0, 1],
    ]);
  });
  it("pairs a declared rename into a single entry", () => {
    const changes = listChanges({
      before: { "menus/old.yaml": "a\nb\n" },
      after: { "menus/new.yaml": "a\nc\n" },
      renames: [{ from: "menus/old.yaml", to: "menus/new.yaml" }],
    });
    expect(changes).toMatchObject([
      { path: "menus/new.yaml", from: "menus/old.yaml", status: "renamed", added: 1, removed: 1 },
    ]);
  });
  it("lists binary files whose content hash changed", () => {
    const changes = listChanges({
      before: {},
      after: {},
      binaryBefore: { "a.png": { hash: "1", size: 3 }, "b.png": { hash: "2", size: 3 } },
      binaryAfter: { "a.png": { hash: "9", size: 4 }, "b.png": { hash: "2", size: 3 } },
    });
    expect(changes).toMatchObject([{ path: "a.png", status: "modified", binary: true }]);
  });
});

describe("ChangeList", () => {
  it("summarises the change set and shows a colored diff per file", () => {
    render(
      <ChangeList
        before={{ "a.yaml": "price: 10\n" }}
        after={{ "a.yaml": "price: 20\n", "b.yaml": "name: Shop\n" }}
        beforeLabel="Serveur"
        afterLabel="Brouillon"
      />,
    );
    expect(screen.getByText(/2 (files changed|fichiers modifiés)/)).toBeInTheDocument();
    const a = screen.getByRole("button", { name: /a\.yaml/ });
    expect(a).toHaveTextContent("+1");
    expect(a).toHaveTextContent("−1");
    expect(screen.getByText("price: 20").closest("tr")).toHaveClass("bg-[var(--success-soft)]");
    fireEvent.click(a);
    expect(screen.queryByText("price: 20")).toBeNull();
    expect(
      within(screen.getByRole("button", { name: /b\.yaml/ })).getByText(/New|Nouveau/),
    ).toBeInTheDocument();
  });
  it("says so when nothing changed", () => {
    render(<ChangeList before={{ "a.yaml": "x" }} after={{ "a.yaml": "x" }} />);
    expect(screen.getByText(/No changes|Aucun changement/)).toBeInTheDocument();
  });
});

describe("ChangeList — one scroll for the whole change set", () => {
  it("wraps long lines and does not cap each diff in its own scroll box", () => {
    const long = `description: ${"x".repeat(400)}\n`;
    render(<ChangeList before={{ "a.yaml": "a\n" }} after={{ "a.yaml": long }} />);
    const region = screen.getByRole("region");
    expect(region.className).not.toMatch(/max-h-/);
    expect(screen.getByText(long.trimEnd()).closest("td")).toHaveClass("whitespace-pre-wrap");
  });
  it("keeps the file header pinned while its diff scrolls by", () => {
    render(<ChangeList before={{ "a.yaml": "a\n" }} after={{ "a.yaml": "b\n" }} />);
    expect(screen.getByRole("button", { name: /a\.yaml/ })).toHaveClass("sticky");
  });
});
