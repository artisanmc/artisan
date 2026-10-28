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
    expect(safeAuthReturn("/servers/824473e8-413e-4109-ae91-185021a150e9")).toBe(
      "/servers/824473e8-413e-4109-ae91-185021a150e9",
    );
  });
});
