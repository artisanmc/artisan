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
    expect(lines[0]).toMatch(/ghost.*le menu main/);
    expect(lines[0]).toMatch(/ne s'affichera pas|show nothing/);
    expect(lines[1]).toMatch(/anvil.*le menu main, le menu shop.*jobs.*jobs:anvil/);
  });

  test("a name written in a kind's file, and the layers of a composed image that take nothing", () => {
    render(
      <ServerChecksSection
        checks={{
          status: "ready",
          unreadable: [],
          issues: [
            { kind: "image_missing", ref: "ghost", menus: ["main"], files: ["huds/main.yml"] },
            { kind: "layer_missing", image: "window", refs: ["anvil", "kit:ghost"] },
            { kind: "layer_missing", image: "badge", refs: ["window"] },
          ],
        }}
      />,
    );
    const lines = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(lines[0]).toMatch(/ghost.*le menu main, le fichier huds\/main\.yml/);
    expect(lines[1]).toMatch(/window a des calques qui nomment anvil, kit:ghost.*laissés de côté/);
    expect(lines[2]).toMatch(/badge a un calque qui nomme window.*laissé de côté/);
  });
});
