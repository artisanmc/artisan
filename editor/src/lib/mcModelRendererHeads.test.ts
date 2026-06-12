import { describe, expect, it } from "vitest";
import { ENTITY_RENDER_MAP } from "./mcModelRenderer";

const HEADS: Record<string, string> = {
  player_head: "entity/player/wide/steve",
  zombie_head: "entity/zombie/zombie",
  creeper_head: "entity/creeper/creeper",
  skeleton_skull: "entity/skeleton/skeleton",
  wither_skeleton_skull: "entity/skeleton/wither_skeleton",
  piglin_head: "entity/piglin/piglin",
  dragon_head: "entity/enderdragon/dragon",
};

describe("ENTITY_RENDER_MAP head entries", () => {
  for (const [id, texture] of Object.entries(HEADS)) {
    it(`renders ${id} from ${texture}`, () => {
      const def = ENTITY_RENDER_MAP[id];
      expect(def).toBeDefined();
      expect(def!.texturePath).toBe(texture);
      expect(def!.boxes.length).toBeGreaterThan(0);
    });
  }
});
