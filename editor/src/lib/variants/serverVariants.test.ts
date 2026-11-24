import { describe, expect, it } from "vitest";
import {
  serverVariantNames,
  serverVariantProblems,
  serverVariantsFromConfig,
  serverVariantsToConfig,
} from "./serverVariants";

describe("the server's menu variants", () => {
  it("reads and writes config.yml's entries, defaults left out", () => {
    const raw = [
      { name: "vip", parent: "textured", if: [{ has_permission: "rank.vip" }], selectable: false },
      { name: "large" },
    ];
    const read = serverVariantsFromConfig(raw);
    expect(read[1]).toEqual({ name: "large", parent: "default", if: [], selectable: true });
    expect(serverVariantsToConfig(read)).toEqual(raw);
    expect(serverVariantNames({ "menu-variants": raw })).toEqual([
      "default",
      "bedrock",
      "textured",
      "vip",
      "large",
    ]);
    expect(serverVariantNames(null)).toEqual(["default", "bedrock", "textured"]);
  });

  it("finds what the plugin refuses, like ServerVariants.parse", () => {
    const v = (name: string, parent = "default") => ({ name, parent, if: [], selectable: true });
    const problems = serverVariantProblems([
      v("textured"),
      v("Bad"),
      v("a", "b"),
      v("b", "a"),
      v("c", "nowhere"),
      v("ok", "bedrock"),
      v("ok"),
      v("child", "ok"),
    ]);
    expect(Object.fromEntries(problems)).toEqual({
      0: "builtin",
      1: "name",
      2: "loop",
      3: "loop",
      4: "parent",
      6: "duplicate",
    });
  });
});
