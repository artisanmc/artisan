import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { ServerChecksSection } from "./ServerChecksSection";

describe("ServerChecksSection — images", () => {
  test("an image no one holds and a name alone that is another module's, each with its menus", () => {
    render(
      <ServerChecksSection
        checks={{
          status: "ready",
          unreadable: [],
          issues: [
            { kind: "image_missing", ref: "ghost", menus: ["main"] },
            { kind: "image_elsewhere", ref: "anvil", module: "jobs", menus: ["main", "shop"] },
          ],
        }}
      />,
    );
    expect(screen.getByText("2")).toBeInTheDocument();
    const lines = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(lines[0]).toMatch(/main.*ghost/);
    expect(lines[0]).toMatch(/ne s'affichera pas|show nothing/);
    expect(lines[1]).toMatch(/main, shop.*anvil.*jobs.*jobs:anvil/);
  });
});
