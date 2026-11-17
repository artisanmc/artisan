import { describe, expect, it } from "vitest";
import { commandNames, menuRefs } from "./statsContent";
import type { Project } from "./types";

const click = { left: { steps: [{ kind: "action", action: { type: "close" } }] } };
const project = {
  id: "p1",
  diskId: "shop",
  documents: {
    command: [
      { id: "c1", name: "shop" },
      { id: "c2", name: "old", enabled: false },
    ],
    menu: [
      {
        id: "main",
        layers: [
          {
            elements: [
              { id: "buy", display: { click }, states: [] },
              { id: "frame", display: {}, states: [] },
              { id: "sell", display: {}, states: [{ click }] },
            ],
          },
        ],
      },
    ],
  },
} as unknown as Project;

describe("stats content", () => {
  it("names the enabled commands", () => {
    expect(commandNames([project])).toEqual(["shop"]);
  });

  it("names each menu as the server records it, with the elements a click acts on", () => {
    expect(menuRefs([project])).toEqual([{ ref: "shop:main", elements: ["buy", "sell"] }]);
  });
});
