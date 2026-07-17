import { describe, expect, it } from "vitest";
import type { CapturedItem, Project } from "./types";
import { resolveDisplayRef } from "./capturedItems";

const CAPTURED: CapturedItem = {
  id: "ci_key" as CapturedItem["id"],
  name: "Clé Luxury",
  stackYaml: "==: org.bukkit.inventory.ItemStack\nid: minecraft:paper\n",
  display: {
    material: "nexo:arcanist_key", // enriched at capture (recognized custom item)
    enchanted: true,
    count: 1,
    name: "1 clé Luxury",
  },
};

const HEAD: CapturedItem = {
  id: "ci_grade" as CapturedItem["id"],
  name: "Grade Hoplite",
  stackYaml: "==: org.bukkit.inventory.ItemStack\nid: minecraft:player_head\n",
  display: { material: "PLAYER_HEAD", headTexture: "eyJ0ZXh0dXJlcyI6…" },
};

function pack(items: CapturedItem[]): Project {
  return { capturedItems: items } as Project;
}

describe("resolveDisplayRef", () => {
  it("resolves an item: ref to its captured display (material/head/glint)", () => {
    expect(resolveDisplayRef(pack([CAPTURED]), "item:ci_key")).toEqual({
      material: "nexo:arcanist_key",
      enchanted: true,
    });
    expect(resolveDisplayRef(pack([HEAD]), "item:ci_grade")).toEqual({
      material: "PLAYER_HEAD",
      head: "basehead:eyJ0ZXh0dXJlcyI6…",
    });
  });

  it("passes non-item refs through untouched (vanilla, nexo:, placeholders)", () => {
    const p = pack([CAPTURED]);
    expect(resolveDisplayRef(p, "DIAMOND_SWORD")).toEqual({ material: "DIAMOND_SWORD" });
    expect(resolveDisplayRef(p, "nexo:arcanist_key")).toEqual({ material: "nexo:arcanist_key" });
    expect(resolveDisplayRef(p, "{item.icon}")).toEqual({ material: "{item.icon}" });
  });

  it("dangling item: ref degrades to the bare ref (non-hermetic)", () => {
    expect(resolveDisplayRef(pack([]), "item:ghost")).toEqual({ material: "item:ghost" });
  });
});
