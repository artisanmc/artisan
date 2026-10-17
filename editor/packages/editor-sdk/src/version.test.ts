import { describe, expect, it } from "vitest";
import { SDK_VERSION, sdkCompatibility } from "./version";

describe("sdkCompatibility", () => {
  it("accepts a bundle built against the same major and an older or equal minor", () => {
    expect(sdkCompatibility("1.0", "1.0.0")).toBe("compatible");
    expect(sdkCompatibility("1.0.3", "1.2.0")).toBe("compatible");
    expect(sdkCompatibility(SDK_VERSION)).toBe("compatible");
  });

  it("asks for a newer editor when the bundle needs a newer minor or major", () => {
    expect(sdkCompatibility("1.3", "1.2.9")).toBe("older-editor");
    expect(sdkCompatibility("2.0", "1.9.0")).toBe("older-editor");
  });

  it("asks for a newer module when the bundle targets a past major", () => {
    expect(sdkCompatibility("1.4", "2.0.0")).toBe("older-bundle");
  });

  it("refuses what is not a version", () => {
    expect(sdkCompatibility("latest", "1.0.0")).toBe("invalid");
    expect(sdkCompatibility("", "1.0.0")).toBe("invalid");
  });
});
