import { describe, expect, it } from "vitest";
import vector from "../../../testdata/lore-wrap-conformance.json";
import { wrapLore } from "./loreWrap";

/** Editor half of `testdata/lore-wrap-conformance.json` — the plugin asserts the same vector. */
describe("wrapLore conformance", () => {
  for (const c of vector.cases) {
    it(c.name, () => {
      expect(wrapLore(c.line, c.width)).toEqual(c.expected);
    });
  }
});
