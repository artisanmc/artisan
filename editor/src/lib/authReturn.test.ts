import { describe, expect, it } from "vitest";
import { safeAuthReturn } from "./authReturn";

describe("authentication return", () => {
  it.each(["https://evil.test", "//evil.test", "/\\evil.test", "/\nevil.test", null])(
    "rejects unsafe next %s",
    (value) => {
      expect(safeAuthReturn(value)).toBe("/");
    },
  );
  it("keeps a local path", () => {
    expect(safeAuthReturn("/networks/local/servers/local")).toBe("/networks/local/servers/local");
  });
});
